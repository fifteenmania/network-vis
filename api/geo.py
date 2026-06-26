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
    # geo + AS 정보를 한 번에 요청해 ipwhois 별도 조회 제거
    fields = "query,lat,lon,city,country,countryCode,status,as,asname,org"
    payload = [{"query": ip, "fields": fields} for ip in ips]
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

                # "as" 필드 예시: "AS15169 Google LLC" → asn=15169, org="Google LLC"
                as_raw: str = item.get("as", "")
                asn: int | None = None
                as_org: str = item.get("org") or item.get("asname") or "Unknown"
                if as_raw.startswith("AS"):
                    parts = as_raw.split(" ", 1)
                    try:
                        asn = int(parts[0][2:])
                        if len(parts) > 1:
                            as_org = parts[1]
                    except ValueError:
                        pass

                as_info = (
                    {"asn": asn, "org": as_org, "country": item.get("countryCode", ""), "prefix": ""}
                    if asn else None
                )

                result[ip] = {
                    "lat": item.get("lat", 0.0),
                    "lng": item.get("lon", 0.0),
                    "label": f"{city}, {country}" if city else country,
                    "ip": ip,
                    "as": as_info,
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
