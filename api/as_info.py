"""
AS(자율 시스템) 번호 및 BGP prefix 조회 — ipwhois 사용.
"""

from __future__ import annotations
from ipwhois import IPWhois


def lookup_as(ip: str, timeout: int = 5) -> dict | None:
    """
    IP에 대한 ASN, 기관명, 국가, prefix를 반환합니다.
    실패 시 None 반환.
    """
    try:
        obj = IPWhois(ip)
        result = obj.lookup_rdap(inc_nir=False, depth=1, socket_timeout=timeout)
        asn = result.get("asn")
        org = (
            result.get("asn_description")
            or result.get("network", {}).get("name")
            or "Unknown"
        )
        country = result.get("asn_country_code", "")
        prefix = result.get("asn_cidr", "")
        if asn:
            return {
                "asn": int(asn),
                "org": org,
                "country": country,
                "prefix": prefix,
            }
    except Exception:
        pass
    return None


if __name__ == "__main__":
    import json
    for ip in ["141.101.72.1", "8.8.8.8", "104.18.7.192"]:
        print(f"{ip}:", json.dumps(lookup_as(ip), indent=2))
