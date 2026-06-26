"""
MITM(SSL Inspection) 탐지 — 인증서 Issuer를 직접 검사해 기업 방화벽의 TLS 가로채기를 판정합니다.

판정 증거 (인증서 기반, 외부 API 불필요):
  1. 프록시 키워드    — resources/proxy_keywords.json 키워드가 Issuer에 있으면 → INTERCEPTED (확정)
  2. Issuer CA 미등록 — resources/known_ca_orgs.json의 공개 CA 목록과 불일치 → SUSPICIOUS (의심)

판정 등급:
  INTERCEPTED — 프록시/방화벽 제품 키워드가 Issuer에서 감지됨 (확정 증거)
  SUSPICIOUS  — 알려진 공개 CA 목록에 없는 Issuer (목록 누락일 수도 있어 확정 불가)
  CLEAN       — 알려진 공개 CA + 프록시 키워드 없음
  ERROR       — TLS 연결 실패 또는 인증서 파싱 오류
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cryptography import x509
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64


# ── 리소스 로더 ───────────────────────────────────────────────────────────────

def _load_resource(filename: str) -> Any:
    path = Path(__file__).parent / "resources" / filename
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


KNOWN_CA_ORGS: list[str]  = _load_resource("known_ca_orgs.json")
PROXY_KEYWORDS: list[str] = _load_resource("proxy_keywords.json")


# ── 데이터 클래스 ─────────────────────────────────────────────────────────────

@dataclass
class MitmEvidence:
    type: str    # issuer_unknown | proxy_keyword
    detail: str


@dataclass
class MitmResult:
    verdict: str                           # INTERCEPTED | SUSPICIOUS | CLEAN | ERROR
    evidence: list[MitmEvidence] = field(default_factory=list)
    issuerOrg: str = ""
    issuerCN: str = ""
    validityDays: int | None = None


# ── 핑거프린트 계산 ──────────────────────────────────────────────────────────

def spki_fingerprint(der: bytes) -> str:
    """Leaf 인증서 DER에서 SPKI SHA-256 핀을 계산합니다 (sha256/<base64> 형식)."""
    cert = x509.load_der_x509_certificate(der, default_backend())
    spki = cert.public_key().public_bytes(encoding=Encoding.DER, format=PublicFormat.SubjectPublicKeyInfo)
    return "sha256/" + base64.b64encode(hashlib.sha256(spki).digest()).decode()


def cert_fingerprint(der: bytes) -> str:
    """인증서 전체 DER의 SHA-256 hex."""
    return hashlib.sha256(der).hexdigest().upper()


# ── Issuer 파싱 ──────────────────────────────────────────────────────────────

def _issuer_fields(der: bytes) -> tuple[str, str]:
    """인증서 Issuer에서 (O=, CN=) 튜플을 반환합니다. 없으면 빈 문자열."""
    org, cn = "", ""
    try:
        cert = x509.load_der_x509_certificate(der, default_backend())
        for attr in cert.issuer:
            oid = attr.oid.dotted_string
            if oid == "2.5.4.10":   # O
                org = str(attr.value)
            elif oid == "2.5.4.3":  # CN
                cn = str(attr.value)
    except Exception:
        pass
    return org, cn


def _validity_days(der: bytes) -> int | None:
    """Leaf 인증서의 남은 유효일수를 반환합니다."""
    try:
        cert = x509.load_der_x509_certificate(der, default_backend())
        now = datetime.now(timezone.utc)
        return max(0, (cert.not_valid_after_utc - now).days)
    except Exception:
        return None


# ── 핵심 판정 함수 ────────────────────────────────────────────────────────────

def analyze_chain(hostname: str, der_list: list[bytes], full_chain: bool = True) -> dict:
    """
    인증서 체인 DER 바이트 목록을 받아 MITM 여부를 판정합니다.

    Args:
        hostname:   조회 대상 호스트명 (현재 사용 안 함, 향후 확장용)
        der_list:   인증서 체인 DER 바이트 목록 (Leaf이 index 0)
        full_chain: 사용 안 함 (하위 호환 유지)

    Returns:
        MitmResult를 dict로 직렬화한 결과
    """
    if not der_list:
        return asdict(MitmResult(verdict="ERROR"))

    leaf_der = der_list[0]
    evidence: list[MitmEvidence] = []

    try:
        issuer_org, issuer_cn = _issuer_fields(leaf_der)
        validity_days = _validity_days(leaf_der)
    except Exception:
        return asdict(MitmResult(verdict="ERROR"))

    # Issuer 문자열 — O= 우선, 없으면 CN= 사용 (목록 비교용)
    issuer_str = issuer_org or issuer_cn

    # ── 증거 1: 프록시/방화벽 키워드 매칭 (확정 증거) ───────────────────────
    full_issuer = f"{issuer_org} {issuer_cn}".lower()
    matched_kw = [kw for kw in PROXY_KEYWORDS if kw and kw.lower() in full_issuer]
    if matched_kw:
        evidence.append(MitmEvidence(
            type="proxy_keyword",
            detail=f"Issuer에 프록시/방화벽 키워드 감지: {', '.join(matched_kw)}",
        ))

    # ── 증거 2: Issuer CA 공개 목록 불일치 (의심 증거) ───────────────────────
    issuer_known = any(
        known.lower() in issuer_str.lower()
        for known in KNOWN_CA_ORGS
        if known
    )
    if not issuer_known:
        evidence.append(MitmEvidence(
            type="issuer_unknown",
            detail=f"Issuer '{issuer_str}'가 알려진 공개 CA 목록에 없음",
        ))

    # 키워드 매칭 → INTERCEPTED (확정), Issuer 불명 → SUSPICIOUS (의심), 이상 없음 → CLEAN
    if matched_kw:
        verdict = "INTERCEPTED"
    elif not issuer_known:
        verdict = "SUSPICIOUS"
    else:
        verdict = "CLEAN"

    return asdict(MitmResult(
        verdict=verdict,
        evidence=evidence,
        issuerOrg=issuer_org,
        issuerCN=issuer_cn,
        validityDays=validity_days,
    ))


if __name__ == "__main__":
    import socket, ssl, sys
    host = sys.argv[1] if len(sys.argv) > 1 else "api.openai.com"
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    sock = socket.create_connection((host, 443), timeout=10)
    tls = ctx.wrap_socket(sock, server_hostname=host)
    try:
        chain = tls.get_unverified_chain()
        ders = [c.public_bytes(ssl.ENCODING_DER) for c in chain]
    except AttributeError:
        raw = tls.getpeercert(binary_form=True)
        ders = [raw] if raw else []
    tls.close()
    print(json.dumps(analyze_chain(host, ders), indent=2, ensure_ascii=False))
