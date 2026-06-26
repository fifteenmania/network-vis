"""
IP 지리정보 조회 — ip-api.com 배치 API 사용 (무료, 최대 100 IP/요청).
"""

from __future__ import annotations
import httpx


def lookup_geo_batch(ips: list[str]) -> dict[str, dict]:
    """
    IP 목록을 받아 {ip: {lat, lng, label, country}} 형태로 반환합니다.
    타임아웃이나 오류 시 해당 IP는 빈 dict로 반환합니다.
    """
    if not ips:
        return {}

    # ip-api.com 배치: 최대 100개, 무료
    payload = [{"query": ip, "fields": "query,lat,lon,city,country,countryCode,status"} for ip in ips]
    result: dict[str, dict] = {}

    try:
        with httpx.Client(timeout=8) as client:
            resp = client.post("http://ip-api.com/batch", json=payload)
            resp.raise_for_status()
            data = resp.json()

        for item in data:
            ip = item.get("query", "")
            if item.get("status") == "success":
                city = item.get("city", "")
                country = item.get("countryCode", "")
                result[ip] = {
                    "lat": item.get("lat", 0.0),
                    "lng": item.get("lon", 0.0),
                    "label": f"{city}, {country}" if city else country,
                    "ip": ip,
                }
            else:
                result[ip] = {}

    except Exception as e:
        # 실패 시 전부 빈 dict
        for ip in ips:
            result[ip] = {}

    return result


if __name__ == "__main__":
    import json
    r = lookup_geo_batch(["8.8.8.8", "1.1.1.1", "104.18.7.192"])
    print(json.dumps(r, indent=2))
