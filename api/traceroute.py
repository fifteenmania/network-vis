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

def _build_hop(
    hop_num: int,
    ip: str,
    rtts: list[float],
    geo: dict,
    last_known_geo: dict,
) -> dict:
    """파싱 결과와 GeoIP 데이터를 프론트엔드 TraceHop 구조로 변환합니다."""
    if not ip:
        location = dict(last_known_geo) if last_known_geo \
                   else {"lat": 0, "lng": 0, "label": "Unknown", "ip": "*"}
        return {
            "hop": hop_num,
            "ip": "*",
            "hostname": None,
            "rttMs": [],
            "location": location,
            "as": None,
        }

    fallback = dict(last_known_geo) if last_known_geo \
               else {"lat": 0, "lng": 0, "label": "Unknown", "ip": ip}
    used_geo = geo or fallback

    return {
        "hop": hop_num,
        "ip": ip,
        "hostname": None,
        "rttMs": rtts if rtts else [0.0],
        "location": {k: v for k, v in used_geo.items() if k != "as"},
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

    last_known_geo: dict = {}

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
        if ip:
            try:
                geo_map = await asyncio.to_thread(lookup_geo_batch, [ip])
                geo = geo_map.get(ip, {})
            except Exception:
                geo = {}
            if geo:
                last_known_geo = geo

        yield _build_hop(hop_num, ip, rtts, geo, last_known_geo)


# ── 하위 호환 배치 버전 (레거시 /api/trace 엔드포인트용) ──────────────────────

async def run_traceroute_batch(hostname: str, max_hops: int = 20) -> list[dict]:
    """stream_traceroute를 모두 수집해 리스트로 반환합니다."""
    hops: list[dict] = []
    async for hop in stream_traceroute(hostname, max_hops):
        hops.append(hop)
    return hops
