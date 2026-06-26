"""
/api/* 엔드포인트.
각 섹션(DNS / Traceroute / TLS / HTTP)을 독립적으로 제공하여
프론트엔드가 병렬로 호출하고 완료 즉시 UI를 활성화할 수 있게 합니다.
/api/trace 는 전체 응답을 단일 JSON 으로 묶는 레거시 엔드포인트로 유지합니다.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from api.dns_lookup import resolve_chain
from api.traceroute import run_traceroute
from api.tls import get_cert_chain
from api.http_probe import probe_http
from api.geo import lookup_geo_batch

router = APIRouter(prefix="/api")

_FALLBACK_TLS: dict = {
    "steps": [], "certChain": [],
    "negotiated": {"version": "", "cipher": "", "handshakeDurationMs": 0},
}
_FALLBACK_HTTP: dict = {
    "status": 0, "statusText": "error", "protocol": "unknown",
    "durationMs": 0, "bodySize": 0, "requestHeaders": [], "responseHeaders": [],
}
_FALLBACK_CLIENT_GEO: dict = {"lat": 37.5665, "lng": 126.9780, "label": "Seoul, KR"}


async def _client_geo_async() -> dict:
    """퍼블릭 IP 지리정보를 비동기로 조회합니다."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            r = await client.get("http://ip-api.com/json")
            d = r.json()
            return {
                "lat": d.get("lat", 0),
                "lng": d.get("lon", 0),
                "label": f"{d.get('city', '')}, {d.get('countryCode', '')}",
            }
    except Exception:
        return _FALLBACK_CLIENT_GEO


def _safe(result: Any, fallback: Any) -> Any:
    return fallback if isinstance(result, BaseException) else result


_GEO_KEYS = {"lat", "lng", "label", "ip"}

def _geo_point(geo: dict, ip: str) -> dict:
    """geo_map 항목에서 GeoPoint 필드만 추출합니다 (as 키 제거)."""
    return {k: v for k, v in geo.items() if k in _GEO_KEYS} | {"ip": ip}


@router.get("/trace")
async def trace(host: str = Query(..., description="조회할 호스트명 (예: api.openai.com)")):
    t_start = time.perf_counter()

    # ── Phase 1: 호스트명만 있으면 되는 작업 — 전부 동시 실행 ────────────────
    results = await asyncio.gather(
        asyncio.to_thread(resolve_chain, host),      # DNS 재귀 체인
        asyncio.to_thread(run_traceroute, host),     # Traceroute + GeoIP + AS
        asyncio.to_thread(get_cert_chain, host),     # TLS 핸드셰이크 + 인증서
        probe_http(f"https://{host}"),               # HTTP/2 헤더 (이미 async)
        _client_geo_async(),                         # 클라이언트 위치 (이미 async)
        return_exceptions=True,
    )

    dns_result, hops, tls_result, http_result, client_geo = results

    # DNS 실패는 치명적
    if isinstance(dns_result, BaseException):
        raise HTTPException(502, f"DNS 조회 실패: {dns_result}")

    hops       = _safe(hops,       [])
    tls_result = _safe(tls_result, _FALLBACK_TLS)
    http_result= _safe(http_result,_FALLBACK_HTTP)
    client_geo = _safe(client_geo, _FALLBACK_CLIENT_GEO)

    # ── Phase 2: 목적지 GeoIP (DNS 결과의 첫 번째 A 레코드 필요) ─────────────
    a_records = [r for r in dns_result.get("records", []) if r.get("type") == "A"]
    dest_ip = a_records[0]["value"] if a_records else host

    dest_geo_map = await asyncio.to_thread(lookup_geo_batch, [dest_ip])
    dest_geo = dest_geo_map.get(dest_ip) or {
        "lat": 37.4225, "lng": -122.085, "label": "San Francisco, US",
    }

    total_ms = int((time.perf_counter() - t_start) * 1000)

    return JSONResponse({
        "target": host,
        "client": client_geo,
        "destination": _geo_point(dest_geo, dest_ip),
        "dns": dns_result,
        "hops": hops,
        "tls": tls_result,
        "http": http_result,
        "totalDurationMs": total_ms,
    })


# ── 섹션별 독립 엔드포인트 ────────────────────────────────────────────────────
# 프론트엔드가 4개를 동시에 호출하고 완료되는 순서대로 UI를 활성화합니다.

async def _geo_for_dns(dns_result: dict, host: str) -> dict:
    """DNS 결과의 첫 A 레코드로 목적지 GeoIP를 조회합니다."""
    a_records = [r for r in dns_result.get("records", []) if r.get("type") == "A"]
    dest_ip = a_records[0]["value"] if a_records else host
    dest_geo_map = await asyncio.to_thread(lookup_geo_batch, [dest_ip])
    dest_geo = dest_geo_map.get(dest_ip) or {"lat": 37.4225, "lng": -122.085, "label": "San Francisco, US"}
    return _geo_point(dest_geo, dest_ip)


@router.get("/dns")
async def dns_endpoint(host: str = Query(...)):
    """DNS 재귀 조회 체인 + 클라이언트/목적지 GeoIP"""
    dns_result, client_geo = await asyncio.gather(
        asyncio.to_thread(resolve_chain, host),
        _client_geo_async(),
        return_exceptions=True,
    )
    if isinstance(dns_result, BaseException):
        raise HTTPException(502, f"DNS 조회 실패: {dns_result}")
    client_geo = _safe(client_geo, _FALLBACK_CLIENT_GEO)
    destination = await _geo_for_dns(dns_result, host)
    return JSONResponse({"dns": dns_result, "client": client_geo, "destination": destination})


@router.get("/traceroute")
async def traceroute_endpoint(host: str = Query(...)):
    """Traceroute + GeoIP + AS 정보"""
    try:
        hops = await asyncio.to_thread(run_traceroute, host)
        return JSONResponse(hops)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/tls")
async def tls_endpoint(host: str = Query(...)):
    """TLS 핸드셰이크 + 인증서 체인"""
    try:
        result = await asyncio.to_thread(get_cert_chain, host)
        return JSONResponse(result)
    except Exception as e:
        raise HTTPException(502, str(e))


@router.get("/http")
async def http_endpoint(host: str = Query(...)):
    """HTTP/2 요청/응답 헤더"""
    try:
        result = await probe_http(f"https://{host}")
        return JSONResponse(result)
    except Exception as e:
        raise HTTPException(502, str(e))
