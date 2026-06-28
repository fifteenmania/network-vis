"""
MITM(SSL Inspection) 탐지 — 신뢰저장소 이중 검증을 1차 근거로 기업 방화벽의 TLS 가로채기를 판정합니다.

판정 근거:
  1. 신뢰저장소 불일치 (가장 강력) — 공개 CA 번들(certifi)로는 검증 실패하나
     OS(사내 CA 설치됨) 신뢰저장소로는 성공 → 사내 방화벽 가로채기 거의 확실
  2. 프록시 키워드 (제품 식별)     — resources/proxy_keywords.json 키워드가 Issuer에 있으면 확정
  3. Issuer CA 미등록 (보조 의심)  — resources/known_ca_orgs.json 공개 CA 목록과 불일치

판정 등급:
  INTERCEPTED — 신뢰저장소 불일치 또는 프록시/방화벽 제품 키워드 감지 (확정 증거)
  SUSPICIOUS  — 공개 CA로 검증 불가 (사내 CA 미설치, 자가서명, 만료 등)
  CLEAN       — 공개 CA로 정상 검증됨 (가로채기 흔적 없음)
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
    osTrusted: bool | None = None          # OS(사내 CA 포함) 신뢰저장소 검증 결과


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

def analyze_chain(
    hostname: str,
    der_list: list[bytes],
    public_trusted: bool | None = None,
    os_trusted: bool | None = None,
    full_chain: bool = True,
) -> dict:
    """
    인증서 체인과 신뢰저장소 검증 결과를 받아 MITM 여부를 판정합니다.

    1차 근거(신뢰저장소): 공개 CA 번들(certifi)로는 검증 실패하나 OS(사내 CA 설치됨)
    저장소로는 성공하면 → 사내 방화벽이 가로채는 것이 거의 확실(INTERCEPTED).

    보조 근거(인증서 문자열): Issuer의 프록시/방화벽 제품 키워드는 "어떤 제품인가"를
    식별하고 판정을 강화한다. 공개 CA 목록 불일치는 약한 의심 신호로만 사용.

    Args:
        hostname:        조회 대상 호스트명 (현재 사용 안 함, 향후 확장용)
        der_list:        인증서 체인 DER 바이트 목록 (Leaf이 index 0)
        public_trusted:  공개 CA 번들 검증 결과 (True/False/None=판정불가)
        os_trusted:      OS 신뢰저장소 검증 결과 (True/False/None=판정불가)
        full_chain:      사용 안 함 (하위 호환 유지)

    Returns:
        MitmResult를 dict로 직렬화한 결과
    """
    if not der_list:
        return asdict(MitmResult(verdict="ERROR", osTrusted=os_trusted))

    leaf_der = der_list[0]
    evidence: list[MitmEvidence] = []

    try:
        issuer_org, issuer_cn = _issuer_fields(leaf_der)
        validity_days = _validity_days(leaf_der)
    except Exception:
        return asdict(MitmResult(verdict="ERROR", osTrusted=os_trusted))

    # Issuer 문자열 — O= 우선, 없으면 CN= 사용 (목록 비교용)
    issuer_str = issuer_org or issuer_cn
    full_issuer = f"{issuer_org} {issuer_cn}".lower()

    matched_kw = [kw for kw in PROXY_KEYWORDS if kw and kw.lower() in full_issuer]
    trust_store_mismatch = (public_trusted is False and os_trusted is True)

    # ── 증거 1: 신뢰저장소 불일치 (가장 강력한 증거 — 최상단 표시) ───────────
    if trust_store_mismatch:
        evidence.append(MitmEvidence(
            type="trust_store_mismatch",
            detail="공개 CA로는 검증 실패하나 이 PC의 신뢰저장소로는 성공 — 사내 CA가 가로채는 중",
        ))

    # ── 증거 2: 프록시/방화벽 제품 키워드 (제품 식별, 확정 증거) ─────────────
    if matched_kw:
        evidence.append(MitmEvidence(
            type="proxy_keyword",
            detail=f"Issuer에 프록시/방화벽 키워드 감지: {', '.join(matched_kw)}",
        ))

    # ── 증거 3: Issuer 공개 CA 목록 불일치 (보조 증거) ───────────────────────
    # 공개 검증이 통과했다면 정상 인증서이므로 목록 누락에 의한 오탐을 막기 위해 추가하지 않음.
    issuer_known = any(
        known.lower() in issuer_str.lower()
        for known in KNOWN_CA_ORGS
        if known
    )
    if public_trusted is not True and not issuer_known:
        evidence.append(MitmEvidence(
            type="issuer_unknown",
            detail=f"Issuer '{issuer_str}'가 알려진 공개 CA 목록에 없음",
        ))

    # ── 판정 ──────────────────────────────────────────────────────────────────
    if matched_kw or trust_store_mismatch:
        verdict = "INTERCEPTED"
    elif public_trusted is True:
        verdict = "CLEAN"
    elif public_trusted is False:
        # 공개로 신뢰 불가 (OS로도 불가하거나 미확인) → 의심
        verdict = "SUSPICIOUS"
    else:
        # 신뢰저장소 검증 불가(네트워크 오류 등) → 기존 휴리스틱(CA 목록)으로 폴백
        verdict = "SUSPICIOUS" if not issuer_known else "CLEAN"

    return asdict(MitmResult(
        verdict=verdict,
        evidence=evidence,
        issuerOrg=issuer_org,
        issuerCN=issuer_cn,
        validityDays=validity_days,
        osTrusted=os_trusted,
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
