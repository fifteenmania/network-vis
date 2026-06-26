"""
TLS 인증서 체인 및 핸드셰이크 정보 수집.
ssl 모듈로 연결 후 cryptography 로 인증서를 상세 파싱합니다.
MITM 판정(mitm.py)과 차단 유형 분류(block_diagnosis.py)를 통합 호출합니다.
"""

from __future__ import annotations

import socket
import ssl
import time
from dataclasses import dataclass, asdict

from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.asymmetric import rsa, ec, ed25519, ed448

from api.mitm import analyze_chain, spki_fingerprint, cert_fingerprint
from api.block_diagnosis import diagnose_block


@dataclass
class TlsStep:
    step: str
    description: str
    durationMs: int
    detail: str = ""


@dataclass
class CertInfo:
    subject: str
    issuer: str
    serialNumber: str
    validFrom: str
    validUntil: str
    signatureAlgorithm: str
    keyType: str
    san: list[str]
    ocspUrl: str | None
    isRoot: bool
    isTrusted: bool
    spkiFingerprint: str = ""
    certFingerprint: str = ""


@dataclass
class TlsNegotiated:
    version: str
    cipher: str
    handshakeDurationMs: int


@dataclass
class TlsResult:
    steps: list[TlsStep]
    certChain: list[CertInfo]
    negotiated: TlsNegotiated


def _key_type(cert: x509.Certificate) -> str:
    pub = cert.public_key()
    if isinstance(pub, rsa.RSAPublicKey):
        return f"RSA-{pub.key_size}"
    if isinstance(pub, ec.EllipticCurvePublicKey):
        return f"EC-{pub.key_size} ({pub.curve.name})"
    if isinstance(pub, ed25519.Ed25519PublicKey):
        return "Ed25519"
    if isinstance(pub, ed448.Ed448PublicKey):
        return "Ed448"
    return "Unknown"


def _get_san(cert: x509.Certificate) -> list[str]:
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        return [str(name.value) for name in ext.value]
    except Exception:
        return []


def _get_ocsp_url(cert: x509.Certificate) -> str | None:
    try:
        ext = cert.extensions.get_extension_for_class(x509.AuthorityInformationAccess)
        for desc in ext.value:
            if desc.access_method == x509.oid.AuthorityInformationAccessOID.OCSP:
                return desc.access_location.value
    except Exception:
        pass
    return None


def _parse_cert(der: bytes, is_root: bool) -> CertInfo:
    cert = x509.load_der_x509_certificate(der, default_backend())

    def dn(name: x509.Name) -> str:
        parts = []
        for attr in reversed(name.rdns):
            for ava in attr:
                parts.append(f"{ava.oid.dotted_string}={ava.value}" if ava.oid.dotted_string not in _OID_MAP else f"{_OID_MAP[ava.oid.dotted_string]}={ava.value}")
        return ", ".join(parts)

    try:
        spki_fp = spki_fingerprint(der)
    except Exception:
        spki_fp = ""
    try:
        cert_fp = cert_fingerprint(der)
    except Exception:
        cert_fp = ""

    return CertInfo(
        subject=dn(cert.subject),
        issuer=dn(cert.issuer),
        serialNumber=format(cert.serial_number, "x").upper(),
        validFrom=cert.not_valid_before_utc.isoformat(),
        validUntil=cert.not_valid_after_utc.isoformat(),
        signatureAlgorithm=cert.signature_hash_algorithm.name if cert.signature_hash_algorithm else "unknown",
        keyType=_key_type(cert),
        san=_get_san(cert),
        ocspUrl=_get_ocsp_url(cert),
        isRoot=is_root,
        isTrusted=True,
        spkiFingerprint=spki_fp,
        certFingerprint=cert_fp,
    )


_OID_MAP = {
    "2.5.4.3":  "CN",
    "2.5.4.6":  "C",
    "2.5.4.7":  "L",
    "2.5.4.8":  "ST",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
}


def get_cert_chain(hostname: str, port: int = 443) -> dict:
    """
    hostname:port에 TLS로 연결하여 인증서 체인, 핸드셰이크 정보,
    MITM 판정, 차단 유형 분류를 포함한 dict를 반환합니다.
    """
    steps: list[TlsStep] = []
    resolved_ip: str | None = None

    # ── DNS 해석 ─────────────────────────────────────────────────────────────
    try:
        resolved_ip = socket.gethostbyname(hostname)
    except Exception:
        pass

    # ── TCP 연결 ─────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    tcp_ok = False
    sock = None
    try:
        sock = socket.create_connection((hostname, port), timeout=10)
        tcp_ms = int((time.perf_counter() - t0) * 1000)
        tcp_ok = True
        steps.append(TlsStep("TCP Connect", f"TCP 연결 → {hostname}:{port}", tcp_ms))
    except Exception as e:
        block = diagnose_block(hostname, resolved_ip, True, False, False, None)
        return asdict(TlsResult(
            steps=[TlsStep("TCP Connect", str(e), 0)],
            certChain=[],
            negotiated=TlsNegotiated("", "", 0),
        )) | {"mitm": None, "blockDiagnosis": block}

    # ── TLS 핸드셰이크 ────────────────────────────────────────────────────────
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    t1 = time.perf_counter()
    tls_ok = False
    tls_sock = None
    try:
        tls_sock = ctx.wrap_socket(sock, server_hostname=hostname)
        hs_ms = int((time.perf_counter() - t1) * 1000)
        tls_ok = True
    except Exception as e:
        if sock:
            sock.close()
        block = diagnose_block(hostname, resolved_ip, True, True, False, None)
        return asdict(TlsResult(
            steps=steps + [TlsStep("TLS Handshake", str(e), 0)],
            certChain=[],
            negotiated=TlsNegotiated("", "", 0),
        )) | {"mitm": None, "blockDiagnosis": block}

    tls_ver = tls_sock.version() or "TLS"
    cipher_name, _, key_bits = tls_sock.cipher() or ("unknown", None, None)

    steps += [
        TlsStep("ClientHello", f"클라이언트 Hello 전송 (SNI: {hostname})", hs_ms // 4,
                detail="Supported versions, cipher suites, extensions"),
        TlsStep("ServerHello", f"서버 Hello 수신 → {tls_ver}", hs_ms // 4,
                detail=f"Cipher: {cipher_name}"),
        TlsStep("Certificate", "서버 인증서 체인 수신", hs_ms // 4),
        TlsStep("Finished", "핸드셰이크 완료 — 암호화 채널 수립", hs_ms // 4,
                detail=f"Key bits: {key_bits}"),
    ]

    # ── 인증서 체인 파싱 ──────────────────────────────────────────────────────
    cert_chain: list[CertInfo] = []
    der_list: list[bytes] = []
    full_chain_available = False

    try:
        # get_unverified_chain() — Python 3.13+ 에서 전체 체인 반환
        chain_objs = tls_sock.get_unverified_chain()
        if chain_objs:
            full_chain_available = True
            for i, cert_obj in enumerate(chain_objs):
                is_root = (i == len(chain_objs) - 1)
                der = cert_obj.public_bytes(ssl.ENCODING_DER)
                der_list.append(der)
                cert_chain.append(_parse_cert(der, is_root))
    except AttributeError:
        # Python 3.12 이하: leaf cert만 가져올 수 있음
        pass

    if not cert_chain:
        try:
            der = tls_sock.getpeercert(binary_form=True)
            if der:
                der_list.append(der)
                cert_chain.append(_parse_cert(der, is_root=False))
        except Exception:
            pass

    tls_sock.close()

    # ── MITM 판정 ─────────────────────────────────────────────────────────────
    mitm = analyze_chain(hostname, der_list, full_chain=full_chain_available) if der_list else None

    # ── 차단 유형 판정 ────────────────────────────────────────────────────────
    block = diagnose_block(
        hostname=hostname,
        resolved_ip=resolved_ip,
        dns_ok=resolved_ip is not None,
        tcp_ok=tcp_ok,
        tls_ok=tls_ok,
        http_code=None,   # HTTP 코드는 router에서 별도 주입
    )

    result = asdict(TlsResult(
        steps=steps,
        certChain=cert_chain,
        negotiated=TlsNegotiated(
            version=tls_ver,
            cipher=cipher_name,
            handshakeDurationMs=hs_ms,
        ),
    ))
    result["mitm"] = mitm
    result["blockDiagnosis"] = block
    return result


if __name__ == "__main__":
    import json, sys
    host = sys.argv[1] if len(sys.argv) > 1 else "api.openai.com"
    print(json.dumps(get_cert_chain(host), indent=2, ensure_ascii=False))
