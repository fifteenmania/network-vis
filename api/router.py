"""
/api/trace 오케스트레이터 — DNS, Traceroute, TLS, HTTP를 순서대로 실행하고
NetworkTrace 형태로 반환합니다.
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from api.dns_lookup import resolve_chain
from api.traceroute import run_traceroute
from api.tls import get_cert_chain
from api.http_probe import probe_http
from api.geo import lookup_geo_batch

router = APIRouter(prefix="/api")


def _client_geo() -> dict:
    """서버(=클라이언트 측) 퍼블릭 IP 지리정보를 반환합니다."""
    try:
        import httpx
        r = httpx.get("http://ip-api.com/json", timeout=4)
        d = r.json()
        return {"lat": d.get("lat", 0), "lng": d.get("lon", 0), "label": f"{d.get('city','')}, {d.get('countryCode','')}"}
    except Exception:
        return {"lat": 37.5665, "lng": 126.9780, "label": "Seoul, KR"}


@router.get("/trace")
async def trace(host: str = Query(..., description="조회할 호스트명 (예: api.openai.com)")):
    t_start = time.perf_counter()

    # ── DNS (동기, 빠름) ──────────────────────────────────────────────────────
    try:
        dns_result = resolve_chain(host)
    except Exception as e:
        raise HTTPException(502, f"DNS 조회 실패: {e}")

    # ── Traceroute (오래 걸림 — 별도 스레드) ─────────────────────────────────
    try:
        hops = await asyncio.to_thread(run_traceroute, host)
    except Exception as e:
        hops = []

    # ── TLS ───────────────────────────────────────────────────────────────────
    try:
        tls_result = await asyncio.to_thread(get_cert_chain, host)
    except Exception as e:
        tls_result = {"steps": [], "certChain": [], "negotiated": {"version": "", "cipher": "", "handshakeDurationMs": 0}}

    # ── HTTP ──────────────────────────────────────────────────────────────────
    try:
        http_result = await probe_http(f"https://{host}")
    except Exception as e:
        http_result = {"status": 0, "statusText": str(e), "protocol": "unknown",
                       "durationMs": 0, "bodySize": 0, "requestHeaders": [], "responseHeaders": []}

    # ── 클라이언트 / 목적지 geo ───────────────────────────────────────────────
    client_geo = await asyncio.to_thread(_client_geo)

    dest_ip = dns_result["records"][0]["value"] if dns_result.get("records") else host
    dest_geo_map = await asyncio.to_thread(lookup_geo_batch, [dest_ip])
    dest_geo = dest_geo_map.get(dest_ip) or {"lat": 37.4225, "lng": -122.085, "label": "San Francisco, US"}

    total_ms = int((time.perf_counter() - t_start) * 1000)

    return JSONResponse({
        "target": host,
        "client": client_geo,
        "destination": dest_geo,
        "dns": dns_result,
        "hops": hops,
        "tls": tls_result,
        "http": http_result,
        "totalDurationMs": total_ms,
    })
