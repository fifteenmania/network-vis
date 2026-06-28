"""
DNS 재귀 조회 체인 구현.
Root NS → TLD NS → Authoritative NS 각 단계를 직접 쿼리해서 경로를 추적합니다.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, asdict

import dns.message
import dns.name
import dns.query
import dns.rdatatype
import dns.resolver
import dns.flags


# ── 결과 타입 ─────────────────────────────────────────────────────────────────

@dataclass
class DnsRecord:
    type: str
    value: str
    ttl: int


@dataclass
class DnsChainStep:
    server: str
    serverLabel: str
    serverType: str          # recursive | root | tld | authoritative
    query: str
    queryType: str
    responseType: str        # referral | answer | cached
    records: list[DnsRecord]
    durationMs: int


@dataclass
class DnsResult:
    hostname: str
    records: list[DnsRecord]
    resolver: str
    durationMs: int
    chain: list[DnsChainStep]


# ── 공개 Root NS 목록 ─────────────────────────────────────────────────────────
ROOT_SERVERS = [
    ("198.41.0.4",    "a.root-servers.net"),
    ("170.247.170.2", "b.root-servers.net"),
]


def _query_no_recurse(server_ip: str, qname: str, rdtype: int, timeout: float = 3.0) -> dns.message.Message:
    q = dns.message.make_query(qname, rdtype)
    q.flags &= ~dns.flags.RD   # 재귀 비활성화
    return dns.query.udp(q, server_ip, timeout=timeout)


def _extract_ns_ips(msg: dns.message.Message) -> list[tuple[str, str]]:
    """Authority + Additional 섹션에서 NS 이름 + glue A 주소를 추출합니다."""
    ns_names: list[str] = []
    for rrset in msg.authority:
        if rrset.rdtype == dns.rdatatype.NS:
            ns_names = [str(r.target) for r in rrset]
            break

    ns_ips: list[tuple[str, str]] = []
    for rrset in msg.additional:
        if rrset.rdtype == dns.rdatatype.A:
            name = str(rrset.name).rstrip(".")
            for r in rrset:
                ns_ips.append((str(r), name))

    # glue 레코드가 없으면 NS 이름으로 별도 해석
    if not ns_ips and ns_names:
        try:
            ans = dns.resolver.resolve(ns_names[0].rstrip("."), "A", lifetime=3)
            ns_ips = [(str(r), ns_names[0].rstrip(".")) for r in ans]
        except Exception:
            pass

    return ns_ips


def _rrset_records(rrset) -> list[DnsRecord]:
    rdtype_name = dns.rdatatype.to_text(rrset.rdtype)
    out = []
    for r in rrset:
        try:
            val = str(r.target).rstrip(".")
        except AttributeError:
            val = str(r)
        out.append(DnsRecord(type=rdtype_name, value=val, ttl=rrset.ttl))
    return out


# ── 메인 함수 ──────────────────────────────────────────────────────────────────

def resolve_chain(hostname: str) -> dict:
    """hostname에 대한 DNS 재귀 조회 체인을 수행하고 dict를 반환합니다."""
    qname = hostname.rstrip(".")
    chain: list[DnsChainStep] = []

    # ── 0. OS 로컬 캐시 (기록용) ─────────────────────────────────────────────
    t0 = time.perf_counter()
    try:
        dns.resolver.resolve(qname, "A", lifetime=2)
        local_ms = int((time.perf_counter() - t0) * 1000)
        cache_hit = True
    except Exception:
        local_ms = 0
        cache_hit = False

    chain.append(DnsChainStep(
        server="127.0.0.1",
        serverLabel="로컬 캐시 (OS stub resolver)",
        serverType="recursive",
        query=qname, queryType="A",
        responseType="cached" if cache_hit else "referral",
        records=[], durationMs=local_ms,
    ))

    # ── 1. Root NS ────────────────────────────────────────────────────────────
    root_ip, root_name = ROOT_SERVERS[0]
    t0 = time.perf_counter()
    try:
        root_resp = _query_no_recurse(root_ip, qname, dns.rdatatype.A)
        root_ms = int((time.perf_counter() - t0) * 1000)
        tld_ns_ips = _extract_ns_ips(root_resp)
        root_records = []
        for rrset in root_resp.authority:
            if rrset.rdtype == dns.rdatatype.NS:
                root_records = _rrset_records(rrset)[:2]
                break
    except Exception:
        root_ms = 0; tld_ns_ips = []; root_records = []

    chain.append(DnsChainStep(
        server=root_ip, serverLabel=f"Root NS ({root_name})",
        serverType="root", query=qname, queryType="A",
        responseType="referral", records=root_records, durationMs=root_ms,
    ))

    tld = qname.rsplit(".", 1)[-1] if "." in qname else qname
    # 루트 응답에서 TLD NS를 얻지 못한 경우, .com 한정으로만 알려진 gtld 서버를 폴백 사용
    if not tld_ns_ips and tld == "com":
        tld_ns_ips = [("192.5.6.30", "a.gtld-servers.net")]

    # ── 2. TLD NS ─────────────────────────────────────────────────────────────
    auth_ns_ips: list[tuple[str, str]] = []
    if tld_ns_ips:
        tld_ip, tld_name = tld_ns_ips[0]
        t0 = time.perf_counter()
        try:
            tld_resp = _query_no_recurse(tld_ip, qname, dns.rdatatype.A)
            tld_ms = int((time.perf_counter() - t0) * 1000)
            auth_ns_ips = _extract_ns_ips(tld_resp)
            tld_records = []
            for rrset in tld_resp.authority:
                if rrset.rdtype == dns.rdatatype.NS:
                    tld_records = _rrset_records(rrset)[:2]
                    break
        except Exception:
            tld_ms = 0; auth_ns_ips = []; tld_records = []

        chain.append(DnsChainStep(
            server=tld_ip, serverLabel=f".{tld} TLD NS ({tld_name})",
            serverType="tld", query=qname, queryType="A",
            responseType="referral", records=tld_records, durationMs=tld_ms,
        ))

    # ── 3. Authoritative NS ───────────────────────────────────────────────────
    if auth_ns_ips:
        auth_ip, auth_name = auth_ns_ips[0]
        t0 = time.perf_counter()
        try:
            auth_resp = _query_no_recurse(auth_ip, qname, dns.rdatatype.A)
            auth_ms = int((time.perf_counter() - t0) * 1000)
            auth_records: list[DnsRecord] = []
            for rrset in auth_resp.answer:
                auth_records.extend(_rrset_records(rrset))
            if not auth_records:
                for rrset in auth_resp.authority:
                    auth_records.extend(_rrset_records(rrset))
        except Exception:
            auth_ip = auth_ns_ips[0][0]; auth_name = auth_ns_ips[0][1]
            auth_ms = 0; auth_records = []

        chain.append(DnsChainStep(
            server=auth_ip, serverLabel=f"Authoritative NS ({auth_name})",
            serverType="authoritative", query=qname, queryType="A",
            responseType="answer", records=auth_records, durationMs=auth_ms,
        ))

    # ── 최종 레코드: 시스템 리졸버로 A/AAAA/CNAME 수집 ──────────────────────
    final_records: list[DnsRecord] = []
    t_final = time.perf_counter()
    for rdtype in ("CNAME", "A", "AAAA"):
        try:
            ans = dns.resolver.resolve(qname, rdtype, lifetime=5)
            for r in ans.rrset:
                try:
                    val = str(r.target).rstrip(".")
                except AttributeError:
                    val = str(r)
                final_records.append(DnsRecord(type=rdtype, value=val, ttl=ans.rrset.ttl))
            if rdtype in ("A", "AAAA") and final_records:
                break
        except Exception:
            pass
    final_ms = int((time.perf_counter() - t_final) * 1000)

    # 실제 시스템 리졸버(OS stub resolver의 상위 nameserver)를 표기합니다.
    try:
        _ns = dns.resolver.get_default_resolver().nameservers
        resolver_label = ", ".join(str(n) for n in _ns[:2]) if _ns else "시스템 리졸버"
    except Exception:
        resolver_label = "시스템 리졸버"

    result = DnsResult(
        hostname=qname,
        records=final_records,
        resolver=resolver_label,
        durationMs=final_ms,
        chain=chain,
    )
    return asdict(result)


if __name__ == "__main__":
    import json, sys
    host = sys.argv[1] if len(sys.argv) > 1 else "api.openai.com"
    print(json.dumps(resolve_chain(host), indent=2))
