"""
/api/* 엔드포인트.
각 섹션(DNS / Traceroute / TLS / HTTP)을 독립적으로 제공하여
프론트엔드가 병렬로 호출하고 완료 즉시 UI를 활성화할 수 있게 합니다.
/api/trace 는 전체 응답을 단일 JSON 으로 묶는 레거시 엔드포인트로 유지합니다.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse

from api.dns_lookup import resolve_chain
from api.traceroute import stream_traceroute, run_traceroute_batch
from api.tls import get_cert_chain
from api.http_probe import probe_http
from api.geo import lookup_geo_batch
from api.cdn_pop import fetch_cdn_pop, CDN_PROBES, ANYCAST_ASNS
from api.ipclass import is_internal_ip

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


_GEO_KEYS = {"lat", "lng", "label"}

def _geo_point(geo: dict, ip: str) -> dict:
    """geo_map 항목에서 GeoPoint 필드만 추출합니다 (as, iata 키 제거)."""
    return {k: v for k, v in geo.items() if k in _GEO_KEYS} | {"ip": ip}


@router.get("/trace")
async def trace(host: str = Query(..., description="조회할 호스트명 (예: api.openai.com)")):
    t_start = time.perf_counter()

    # ── Phase 1: 호스트명만 있으면 되는 작업 — 전부 동시 실행 ────────────────
    results = await asyncio.gather(
        asyncio.to_thread(resolve_chain, host),      # DNS 재귀 체인
        run_traceroute_batch(host),                  # Traceroute + GeoIP + AS (async)
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

    # ── Phase 2: 목적지 GeoIP + CDN PoP 교정 ─────────────────────────────────
    destination = await _geo_for_dns(dns_result, host)

    total_ms = int((time.perf_counter() - t_start) * 1000)

    return JSONResponse({
        "target": host,
        "client": client_geo,
        "destination": destination,
        "dns": dns_result,
        "hops": hops,
        "tls": tls_result,
        "http": http_result,
        "totalDurationMs": total_ms,
    })


# ── 섹션별 독립 엔드포인트 ────────────────────────────────────────────────────
# 프론트엔드가 4개를 동시에 호출하고 완료되는 순서대로 UI를 활성화합니다.

async def _geo_for_dns(dns_result: dict, host: str) -> dict:
    """
    DNS 결과의 첫 A 레코드로 목적지 GeoIP를 조회합니다.
    CDN anycast IP 인 경우 진단 엔드포인트로 실제 PoP 좌표를 교정합니다.
    """
    a_records = [r for r in dns_result.get("records", []) if r.get("type") == "A"]
    dest_ip = a_records[0]["value"] if a_records else host

    # 사설 IP(내부망 대상)는 공인 GeoIP가 없습니다.
    if is_internal_ip(dest_ip):
        return {"lat": 0, "lng": 0, "label": "내부망 (사설 IP)", "ip": dest_ip}

    dest_geo_map = await asyncio.to_thread(lookup_geo_batch, [dest_ip])
    dest_geo = dest_geo_map.get(dest_ip)
    if not dest_geo:
        # GeoIP 조회 실패(사내망 차단 등) — 가짜 위치로 표기하지 않고 좌표 불명으로 둡니다.
        return {"lat": 0, "lng": 0, "label": "위치 불명", "ip": dest_ip}

    # CDN anycast 교정: ASN 이 CDN 이면 실제 PoP 좌표로 덮어씁니다
    asn: int | None = (dest_geo.get("as") or {}).get("asn")
    if asn and asn in CDN_PROBES:
        pop = await asyncio.to_thread(fetch_cdn_pop, asn)
        if pop:
            dest_geo = {**dest_geo, **pop}

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
    """
    Traceroute SSE 스트리밍.

    hop이 응답할 때마다 즉시 SSE 이벤트를 전송합니다.
    OS 기본 timeout을 유지하므로 어떤 경로도 누락 없이 추적합니다.

    이벤트 형식:
      data: <TraceHop JSON>    — 각 hop (enriched with GeoIP + AS)
      event: done\ndata: {}    — 스트림 종료
    """
    async def event_gen():
        try:
            async for hop in stream_traceroute(host):
                yield f"data: {json.dumps(hop)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        finally:
            yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # nginx 버퍼링 비활성화
        },
    )


@router.get("/tls")
async def tls_endpoint(host: str = Query(...)):
    """TLS 핸드셰이크 + 인증서 체인 + MITM 판정 + 차단 유형 분류"""
    try:
        result = await asyncio.to_thread(get_cert_chain, host)

        # HTTP 코드를 가져와 blockDiagnosis에 주입 (TLS 성공 시에만)
        if result.get("blockDiagnosis") and result["blockDiagnosis"].get("blockType") == "PASS":
            from api.http_probe import probe_http
            try:
                http_result = await probe_http(f"https://{host}")
                http_code = http_result.get("status")
                if http_code in (403, 407, 451):
                    from api.block_diagnosis import diagnose_block
                    block = await asyncio.to_thread(
                        diagnose_block,
                        host,
                        result["blockDiagnosis"].get("resolvedIp"),
                        True, True, True,
                        http_code,
                    )
                    result["blockDiagnosis"] = block
            except Exception:
                pass

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
