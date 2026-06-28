"""
IP 주소 분류 — 사내망(사설 IP) 홉을 식별합니다.

사내망 환경에서는 traceroute 앞부분이 RFC1918 사설 IP, 루프백, 링크로컬로
채워집니다. 이런 IP는 공인 GeoIP 위치가 없으므로 외부 조회를 건너뛰고
"내부망"으로 표기합니다.
"""

from __future__ import annotations

import ipaddress


def is_internal_ip(ip: str) -> bool:
    """
    사설/내부 IP 여부를 반환합니다.

    True인 경우: RFC1918 사설 대역, 루프백, 링크로컬, 미지정, CGNAT(100.64/10) 등
    공인 GeoIP 위치가 존재하지 않는 주소.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_unspecified
        or addr.is_reserved
    )
