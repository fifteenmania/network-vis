"""
Traceroute 실행 및 파싱.
Windows: tracert -d -h 20 <host>
결과에 GeoIP + AS 정보를 병합해서 반환합니다.
"""

from __future__ import annotations

import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict

from api.geo import lookup_geo_batch
from api.as_info import lookup_as


@dataclass
class TraceHop:
    hop: int
    ip: str
    hostname: str | None
    rttMs: list[float]
    location: dict          # {lat, lng, label, ip}
    as_: dict | None        # {asn, org, country, prefix}  — 'as' 는 예약어라 as_ 사용


def _parse_tracert_windows(output: str) -> list[tuple[int, str, list[float]]]:
    """
    Windows tracert 출력을 파싱합니다.
    반환: [(hop_num, ip, [rtt1, rtt2, rtt3])]
    * * * 타임아웃인 경우 ip=""
    """
    hops: list[tuple[int, str, list[float]]] = []
    # 줄 예: "  3     7 ms     7 ms     7 ms  112.174.50.1"
    # 타임아웃: "  4     *        *        *     Request timed out."
    line_re = re.compile(
        r"^\s*(\d+)"           # hop 번호
        r"(?:\s+(\*|(?:\d+\s+ms))"  # rtt1
        r"\s+(\*|(?:\d+\s+ms))"     # rtt2
        r"\s+(\*|(?:\d+\s+ms)))?"   # rtt3
        r"\s+(.+)$"            # IP 또는 메시지
    )
    rtt_re = re.compile(r"(\d+)\s+ms")

    for line in output.splitlines():
        m = line_re.match(line)
        if not m:
            continue
        hop_num = int(m.group(1))
        tail = m.group(5).strip() if m.group(5) else ""

        # 타임아웃 줄
        if "timed out" in tail.lower() or not tail or tail.startswith("*"):
            hops.append((hop_num, "", []))
            continue

        # IP 주소 추출 (마지막 토큰)
        ip_match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", tail)
        if not ip_match:
            hops.append((hop_num, "", []))
            continue

        ip = ip_match.group(1)
        rtts = [float(r) for r in rtt_re.findall(line)]
        hops.append((hop_num, ip, rtts))

    return hops


def _parse_traceroute_unix(output: str) -> list[tuple[int, str, list[float]]]:
    """
    macOS / Linux traceroute 출력 파싱.
    """
    hops = []
    line_re = re.compile(r"^\s*(\d+)\s+")
    ip_re = re.compile(r"\((\d{1,3}(?:\.\d{1,3}){3})\)")
    rtt_re = re.compile(r"(\d+\.\d+|\d+)\s+ms")

    for line in output.splitlines():
        m = line_re.match(line)
        if not m:
            continue
        hop_num = int(m.group(1))
        ip_match = ip_re.search(line)
        ip = ip_match.group(1) if ip_match else ""
        rtts = [float(r) for r in rtt_re.findall(line)]
        hops.append((hop_num, ip, rtts))

    return hops


def run_traceroute(hostname: str, max_hops: int = 20, timeout: int = 60) -> list[dict]:
    """
    traceroute/tracert를 실행하고, GeoIP + AS 정보가 포함된 hop 목록을 반환합니다.
    """
    is_windows = sys.platform.startswith("win")

    if is_windows:
        cmd = ["tracert", "-d", "-h", str(max_hops), hostname]
    else:
        cmd = ["traceroute", "-n", "-m", str(max_hops), hostname]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        output = proc.stdout
    except subprocess.TimeoutExpired:
        output = ""
    except FileNotFoundError:
        output = ""

    raw_hops = _parse_tracert_windows(output) if is_windows else _parse_traceroute_unix(output)

    # 유효한 IP만 GeoIP / AS 조회
    valid_ips = [ip for _, ip, _ in raw_hops if ip]
    geo_map = lookup_geo_batch(valid_ips)

    # AS 조회: 병렬 처리 (최대 8 스레드)
    as_map: dict[str, dict | None] = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(lookup_as, ip): ip for ip in valid_ips}
        for fut in as_completed(futures):
            ip = futures[fut]
            try:
                as_map[ip] = fut.result()
            except Exception:
                as_map[ip] = None

    # 타임아웃 hop 위치 보간 (이전 hop geo 재사용)
    last_geo: dict = {}
    result: list[dict] = []

    for hop_num, ip, rtts in raw_hops:
        if not ip:
            location = dict(last_geo) if last_geo else {"lat": 0, "lng": 0, "label": "Unknown", "ip": "*"}
            hop_dict = {
                "hop": hop_num,
                "ip": "*",
                "hostname": None,
                "rttMs": [],
                "location": location,
                "as": None,
            }
        else:
            geo = geo_map.get(ip, {})
            if not geo:
                geo = dict(last_geo) if last_geo else {"lat": 0, "lng": 0, "label": "Unknown", "ip": ip}
            else:
                last_geo = geo

            hop_dict = {
                "hop": hop_num,
                "ip": ip,
                "hostname": None,
                "rttMs": rtts if rtts else [0.0],
                "location": {**geo, "ip": ip},
                "as": as_map.get(ip),
            }

        result.append(hop_dict)

    return result


if __name__ == "__main__":
    import json, sys
    host = sys.argv[1] if len(sys.argv) > 1 else "8.8.8.8"
    hops = run_traceroute(host)
    print(json.dumps(hops, indent=2))
