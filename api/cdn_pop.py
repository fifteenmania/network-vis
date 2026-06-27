"""
CDN PoP 탐지 모듈.

Cloudflare / CloudFront / Fastly 의 진단 엔드포인트에 HTTP 요청을 보내
실제 응답 PoP 의 IATA 공항 코드를 추출하고, 해당 코드를 좌표로 변환합니다.

동작 방식:
  - 각 CDN 별로 진단 URL 에 GET 요청을 보내 IATA 코드를 파싱
  - IATA 코드 → 좌표는 api/resources/iata_coords.json 에서 조회
  - 실패 시 None 반환 (호출자가 GeoIP 폴백 처리)
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx

# ── IATA 좌표 DB 로드 ──────────────────────────────────────────────────────────

_IATA_DB: dict[str, dict] = {}

def _load_iata() -> dict[str, dict]:
    global _IATA_DB
    if _IATA_DB:
        return _IATA_DB
    path = Path(__file__).parent / "resources" / "iata_coords.json"
    with open(path, encoding="utf-8") as f:
        _IATA_DB = json.load(f)
    return _IATA_DB


def iata_to_geo(code: str) -> dict | None:
    """IATA 코드(3글자) → {lat, lng, label, iata} 또는 None."""
    db = _load_iata()
    entry = db.get(code.upper())
    if not entry:
        return None
    return {
        "lat":   entry["lat"],
        "lng":   entry["lng"],
        "label": f"{entry['city']}, {entry['country']}",
        "iata":  code.upper(),
    }


# ── CDN 진단 설정 ──────────────────────────────────────────────────────────────

# ASN → (진단 URL, 파서 종류)
CDN_PROBES: dict[int, tuple[str, str]] = {
    13335: ("https://cloudflare.com/cdn-cgi/trace", "cloudflare"),
    16509: ("https://d1.awsstatic.com/",            "cloudfront"),
    54113: ("https://www.fastly.com/",              "fastly"),
}

# 알려진 anycast ASN 집합 (PoP 조회가 없어도 anycast 플래그는 세워야 하는 CDN)
ANYCAST_ASNS: frozenset[int] = frozenset({
    13335,  # Cloudflare
    16509,  # Amazon CloudFront
    54113,  # Fastly
    20940,  # Akamai
    15169,  # Google
    396982, # Google Cloud
    8075,   # Microsoft Azure
    22822,  # Limelight / Edgio
    60068,  # CDN77
    33438,  # StackPath
    19551,  # Imperva
    35415,  # BunnyCDN
})


# ── 파서 ──────────────────────────────────────────────────────────────────────

def _parse_cloudflare(resp: httpx.Response) -> str | None:
    """body: `colo=ICN` → "ICN" """
    m = re.search(r"colo=([A-Z]{3})", resp.text)
    return m.group(1) if m else None


def _parse_cloudfront(resp: httpx.Response) -> str | None:
    """`X-Amz-Cf-Pop: ICN80-P2` → "ICN" """
    header = resp.headers.get("x-amz-cf-pop", "")
    m = re.match(r"([A-Z]{3})\d+", header)
    return m.group(1) if m else None


def _parse_fastly(resp: httpx.Response) -> str | None:
    """`X-Served-By: cache-sjc...-SJC, cache-icn...-ICN` → 마지막 항목의 IATA """
    header = resp.headers.get("x-served-by", "")
    parts = [p.strip() for p in header.split(",") if p.strip()]
    if not parts:
        return None
    # 각 항목은 `cache-{loc}{num}-{IATA}` 형식
    m = re.search(r"-([A-Z]{3})$", parts[-1])
    return m.group(1) if m else None


_PARSERS = {
    "cloudflare":  _parse_cloudflare,
    "cloudfront":  _parse_cloudfront,
    "fastly":      _parse_fastly,
}


# ── 공개 API ──────────────────────────────────────────────────────────────────

def fetch_cdn_pop(asn: int) -> dict | None:
    """
    CDN ASN 에 해당하는 진단 URL 에 요청해 현재 PoP 좌표를 반환합니다.
    진단 URL 이 없는 CDN(Akamai, Google 등) 또는 요청 실패 시 None 을 반환합니다.

    반환값: {lat, lng, label, iata} 또는 None
    """
    probe = CDN_PROBES.get(asn)
    if not probe:
        return None

    url, kind = probe
    parser = _PARSERS[kind]

    try:
        with httpx.Client(timeout=5, follow_redirects=True) as client:
            resp = client.get(url)
        iata = parser(resp)
        if not iata:
            return None
        return iata_to_geo(iata)
    except Exception:
        return None


# ── 진단 실행 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    for asn, (url, _) in CDN_PROBES.items():
        result = fetch_cdn_pop(asn)
        print(f"AS{asn}: {result}")
