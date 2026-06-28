"""
Traceroute 스트리밍 구현.

OS 기본 timeout을 그대로 사용하고, stdout을 줄 단위로 읽으면서
hop이 응답할 때마다 즉시 GeoIP를 조회해 enriched dict를 yield 합니다.

구현 방식:
  subprocess.Popen (blocking, thread) + asyncio.Queue 로 sync/async 브릿지.
  asyncio.create_subprocess_exec 는 uvicorn 환경(Windows ProactorEventLoop)에서
  동작이 불안정할 수 있어 사용하지 않습니다.

timeout 값을 임의로 단축하지 않으므로 RTT가 높은 hop도 정확하게 수집됩니다.
GeoIP 조회(~270ms)는 tracert가 다음 hop을 기다리는 시간과 겹쳐 실질적 추가 지연이 없습니다.
"""

from __future__ import annotations

import asyncio
import re
import subprocess
import sys
import threading
from typing import AsyncIterator

from api.geo import lookup_geo_batch
from api.cdn_pop import fetch_cdn_pop, CDN_PROBES, ANYCAST_ASNS
from api.ipclass import is_internal_ip

# ── 파싱 정규식 ───────────────────────────────────────────────────────────────

_WIN_LINE_RE = re.compile(
    r"^\s*(\d+)"                        # hop 번호
    r"(?:\s+(\*|(?:\d+\s+ms))"         # rtt1
    r"\s+(\*|(?:\d+\s+ms))"            # rtt2
    r"\s+(\*|(?:\d+\s+ms)))?"          # rtt3
    r"\s+(.+)$"                         # IP 또는 메시지
)
_RTT_RE    = re.compile(r"(\d+)\s+ms")
_IP_RE     = re.compile(r"(\d{1,3}(?:\.\d{1,3}){3})")
_UNIX_LINE = re.compile(r"^\s*(\d+)\s+")
_UNIX_IP   = re.compile(r"\((\d{1,3}(?:\.\d{1,3}){3})\)")


def _parse_line_windows(line: str) -> tuple[int, str, list[float]] | None:
    """Windows tracert 한 줄 → (hop, ip, rtts) 또는 None."""
    m = _WIN_LINE_RE.match(line)
    if not m:
        return None
    hop_num = int(m.group(1))
    tail = (m.group(5) or "").strip()

    if "timed out" in tail.lower() or not tail or tail.startswith("*"):
        return (hop_num, "", [])

    ip_m = _IP_RE.search(tail)
    if not ip_m:
        return (hop_num, "", [])

    ip   = ip_m.group(1)
    rtts = [float(r) for r in _RTT_RE.findall(line)]
    return (hop_num, ip, rtts)


def _parse_line_unix(line: str) -> tuple[int, str, list[float]] | None:
    """Unix traceroute 한 줄 → (hop, ip, rtts) 또는 None."""
    m = _UNIX_LINE.match(line)
    if not m:
        return None
    hop_num = int(m.group(1))
    ip_m    = _UNIX_IP.search(line)
    ip      = ip_m.group(1) if ip_m else ""
    rtts    = [float(r) for r in re.findall(r"(\d+\.\d+|\d+)\s+ms", line)]
    return (hop_num, ip, rtts)


def _parse_line(line: str) -> tuple[int, str, list[float]] | None:
    """플랫폼에 따라 적절한 파서로 단일 줄을 파싱합니다."""
    if sys.platform.startswith("win"):
        return _parse_line_windows(line)
    return _parse_line_unix(line)


# ── hop dict 빌더 ─────────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """두 위경도 좌표 간의 구면 거리(km)를 반환합니다."""
    import math
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _rtt_geo_mismatch(rtt_ms: float, client_geo: dict, hop_geo: dict) -> bool:
    """
    RTT 가 GeoIP 위치와 물리적으로 불가능하면 True 를 반환합니다.
    광섬유 속도 ~200km/ms 기준으로 최대 가능 거리를 계산하고,
    1.5x 여유(라우팅 우회 고려)를 적용합니다.
    """
    if rtt_ms <= 0:
        return False
    clat = client_geo.get("lat", 0)
    clng = client_geo.get("lng", 0)
    hlat = hop_geo.get("lat", 0)
    hlng = hop_geo.get("lng", 0)
    if clat == 0 and clng == 0:
        return False
    max_km = rtt_ms * 100 * 1.5   # 편도 = rtt/2, 200km/ms, 1.5x 여유
    actual_km = _haversine_km(clat, clng, hlat, hlng)
    return actual_km > max_km


def _build_hop(
    hop_num: int,
    ip: str,
    rtts: list[float],
    geo: dict,
    anycast: bool,
    internal: bool = False,
) -> dict:
    """파싱 결과와 GeoIP 데이터를 프론트엔드 TraceHop 구조로 변환합니다."""
    if not ip:
        return {
            "hop": hop_num,
            "ip": "*",
            "hostname": None,
            "rttMs": [],
            "anycast": False,
            "internal": False,
            "location": {"lat": 0, "lng": 0, "label": "Unknown"},
            "as": None,
        }

    if internal:
        # 사설 IP는 공인 GeoIP 위치가 없으므로 내부망으로 표기합니다.
        used_geo = {"lat": 0, "lng": 0, "label": "내부망 (사설 IP)", "ip": ip}
    else:
        used_geo = geo if geo else {"lat": 0, "lng": 0, "label": "Unknown", "ip": ip}

    return {
        "hop": hop_num,
        "ip": ip,
        "hostname": None,
        "rttMs": rtts if rtts else [0.0],
        "anycast": anycast,
        "internal": internal,
        "location": {k: v for k, v in used_geo.items() if k not in ("as", "iata")},
        "as": used_geo.get("as"),
    }


# ── subprocess 실행 (스레드에서 blocking) ─────────────────────────────────────

_SENTINEL = object()   # 스트림 종료 신호


def _run_tracert_thread(
    cmd: list[str],
    queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
) -> None:
    """
    별도 스레드에서 tracert를 실행하고 stdout 줄을 asyncio.Queue에 넣습니다.
    완료 시 _SENTINEL을 넣어 종료를 알립니다.
    """
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            loop.call_soon_threadsafe(queue.put_nowait, line)
        proc.stdout.close()
        proc.wait()
    except FileNotFoundError:
        pass   # tracert 명령 없음 — 빈 결과
    except Exception:
        pass
    finally:
        loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)


# ── 스트리밍 엔트리포인트 ─────────────────────────────────────────────────────

async def stream_traceroute(
    hostname: str,
    max_hops: int = 20,
) -> AsyncIterator[dict]:
    """
    tracert/traceroute를 실행하고, hop이 응답할 때마다 enriched dict를 yield합니다.
    OS 기본 timeout을 유지하므로 어떤 경로도 누락 없이 추적합니다.

    구현: subprocess.Popen을 별도 스레드에서 실행하고,
    stdout 줄을 asyncio.Queue로 메인 이벤트 루프에 전달합니다.
    """
    is_windows = sys.platform.startswith("win")
    cmd = (
        ["tracert", "-d", "-h", str(max_hops), hostname]
        if is_windows else
        ["traceroute", "-n", "-m", str(max_hops), hostname]
    )

    loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    thread = threading.Thread(
        target=_run_tracert_thread,
        args=(cmd, queue, loop),
        daemon=True,
    )
    thread.start()

    cdn_pop_cache: dict[int, dict | None] = {}  # ASN → PoP 좌표 (None=조회 실패)
    client_geo: dict = {}                        # RTT 물리 검증용 클라이언트 위치

    while True:
        item = await queue.get()
        if item is _SENTINEL:
            break

        line: str = item
        parsed = _parse_line(line)
        if parsed is None:
            continue

        hop_num, ip, rtts = parsed

        geo: dict = {}
        anycast: bool = False
        internal: bool = False

        if ip:
            internal = is_internal_ip(ip)

        # 사설 IP(내부망)는 공인 GeoIP가 없으므로 외부 조회를 건너뜁니다.
        if ip and not internal:
            # GeoIP 조회
            try:
                geo_map = await asyncio.to_thread(lookup_geo_batch, [ip])
                geo = geo_map.get(ip, {})
            except Exception:
                geo = {}

            # 첫 번째 유효한 공인 홉을 클라이언트 위치 기준으로 사용
            if not client_geo and geo and geo.get("lat") and geo.get("lng"):
                client_geo = geo

            asn: int | None = (geo.get("as") or {}).get("asn")

            # CDN PoP 교정 (Cloudflare / CloudFront / Fastly)
            if asn and asn in CDN_PROBES:
                if asn not in cdn_pop_cache:
                    cdn_pop_cache[asn] = await asyncio.to_thread(fetch_cdn_pop, asn)
                pop = cdn_pop_cache[asn]
                if pop:
                    # GeoIP 좌표를 실제 PoP 좌표로 교정, AS 정보는 유지
                    geo = {**geo, **pop}
                anycast = True

            # PoP 조회 없는 알려진 anycast CDN (Akamai, Google 등)
            elif asn and asn in ANYCAST_ASNS:
                anycast = True

            # RTT 물리 검증: GeoIP 가 존재하고 위치가 이상하면 anycast 의심
            elif geo and rtts and client_geo:
                avg_rtt = sum(rtts) / len(rtts)
                if _rtt_geo_mismatch(avg_rtt, client_geo, geo):
                    anycast = True

        yield _build_hop(hop_num, ip, rtts, geo, anycast, internal)


# ── 하위 호환 배치 버전 (레거시 /api/trace 엔드포인트용) ──────────────────────

async def run_traceroute_batch(hostname: str, max_hops: int = 20) -> list[dict]:
    """stream_traceroute를 모두 수집해 리스트로 반환합니다."""
    hops: list[dict] = []
    async for hop in stream_traceroute(hostname, max_hops):
        hops.append(hop)
    return hops
