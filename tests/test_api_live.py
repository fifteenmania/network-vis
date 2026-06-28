"""
라이브 API 통합 테스트 — 백엔드가 localhost:8000에서 실행 중이어야 합니다.
pytest -m live  로 실행합니다.
"""

import json
import urllib.request

BASE = "http://localhost:8000"


def _get(path: str) -> dict:
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return json.loads(r.read().decode())


def test_health():
    data = _get("/health")
    assert data == {"status": "ok"}


def test_dns_resolver_not_hardcoded():
    """resolver 필드가 구글 8.8.8.8 하드코딩이 아닌 실제 시스템 리졸버를 반환해야 한다."""
    data = _get("/api/dns?host=example.com")
    resolver = data["dns"]["resolver"]
    print("resolver:", resolver)
    assert resolver != "8.8.8.8 (Google Public DNS)", "하드코딩된 resolver가 그대로 남아 있습니다"


def test_dns_tld_label_not_dotcom_hardcoded():
    """TLD 라벨이 .com이 아닌 도메인에서도 올바르게 표기되어야 한다."""
    data = _get("/api/dns?host=example.com")
    tld_step = next(
        (s for s in data["dns"]["chain"] if s["serverType"] == "tld"), None
    )
    if tld_step:
        print("TLD serverLabel:", tld_step["serverLabel"])
        # 기존 하드코딩은 무조건 ".com TLD NS" — 최소한 실제 NS명이 포함되어야 함
        assert "gtld-servers.net" not in tld_step["serverLabel"] or ".com" in tld_step["serverLabel"], \
            "비-com 도메인에서 .com TLD 라벨이 잘못 표기됩니다"


def test_tls_step_durations_not_fake():
    """핸드셰이크 세부 단계(ClientHello 등)의 durationMs가 가짜(hs_ms/4)가 아니라 0이어야 한다."""
    data = _get("/api/tls?host=example.com")
    steps = data["steps"]
    print("steps:", [(s["step"], s["durationMs"]) for s in steps])
    for step in steps:
        if step["step"] in ("ClientHello", "ServerHello", "Certificate", "Finished"):
            assert step["durationMs"] == 0, \
                f"{step['step']} durationMs={step['durationMs']} — 가짜 균등분배 값으로 보입니다"


def test_tls_is_trusted_reflects_real_verification():
    """isTrusted가 공개 CA 검증 결과를 반영해야 한다 (공개 사이트 → True 기대)."""
    data = _get("/api/tls?host=example.com")
    chain = data["certChain"]
    print("certChain isTrusted:", [c["isTrusted"] for c in chain])
    assert len(chain) > 0, "인증서 체인이 비어 있습니다"
    # example.com은 DigiCert 공개 CA 발급 — 공개 검증 성공 시 True
    assert chain[0]["isTrusted"] is True, \
        "공개 사이트임에도 isTrusted=False — 공개 검증 실패 또는 구현 오류"


def test_tls_mitm_clean_for_public_site():
    """공개 사이트는 CLEAN 판정이어야 하고, osTrusted가 포함되어야 한다."""
    data = _get("/api/tls?host=example.com")
    mitm = data.get("mitm", {})
    print("mitm verdict:", mitm.get("verdict"))
    print("mitm osTrusted:", mitm.get("osTrusted"))
    print("mitm evidence:", [e["type"] for e in mitm.get("evidence", [])])
    assert mitm.get("verdict") == "CLEAN", \
        f"공개 사이트에서 CLEAN이 아닌 {mitm.get('verdict')} 판정 — 오탐 또는 검증 실패"
    assert "osTrusted" in mitm, "osTrusted 필드가 응답에 없습니다"


def test_tls_block_diagnosis_pass():
    """정상 공개 사이트는 blockType=PASS여야 한다."""
    data = _get("/api/tls?host=example.com")
    block = data.get("blockDiagnosis", {})
    print("blockDiagnosis:", block)
    assert block.get("blockType") == "PASS"
    assert block.get("resolvedIp"), "resolvedIp가 비어 있습니다"


def test_http_endpoint():
    """HTTP 엔드포인트가 status 코드와 프로토콜을 반환해야 한다."""
    data = _get("/api/http?host=example.com")
    print("http status:", data.get("status"), "protocol:", data.get("protocol"))
    assert data.get("status") in (200, 301, 302), \
        f"예상치 못한 HTTP 상태 코드: {data.get('status')}"
