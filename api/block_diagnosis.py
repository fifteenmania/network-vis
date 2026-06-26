"""
차단 유형 분류 — DNS/IP/SNI(도메인)/HTTP 레벨을 구분해 blockType을 반환합니다.

판정 흐름:
  DNS 실패                  → DNS_BLOCKED
  DNS 성공 + TCP 443 실패   → IP_BLOCKED
  TCP 성공 + TLS 실패       → DOMAIN_BLOCKED (SNI 기반 차단)
  TLS 성공 + HTTP 403/451/407 → CLIENT_BLOCKED
  모두 정상                 → PASS
"""

from __future__ import annotations

import socket
import ssl
from dataclasses import dataclass, asdict

import dns.resolver

_CLIENT_BLOCK_CODES = {403, 407, 451}


@dataclass
class BlockDiagnosis:
    blockType: str   # PASS | DNS_BLOCKED | IP_BLOCKED | DOMAIN_BLOCKED | CLIENT_BLOCKED | UNKNOWN
    detail: str
    rawTcpOk: bool | None   # SNI 없는 raw TCP 성공 여부 (IP vs 도메인 차단 구분용)
    resolvedIp: str          # 실제 사용된 DNS 결과 IP


def _raw_tcp_ok(host: str, port: int = 443, timeout: float = 4.0) -> bool:
    """순수 TCP 연결을 시도합니다 (IP 차단 vs 도메인 차단 구분용)."""
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except Exception:
        return False


def diagnose_block(
    hostname: str,
    resolved_ip: str | None,
    dns_ok: bool,
    tcp_ok: bool,
    tls_ok: bool,
    http_code: int | None,
) -> dict:
    """
    각 레이어 성공 여부를 받아 차단 유형을 판정합니다.

    Args:
        hostname:    조회 대상 호스트명
        resolved_ip: 로컬 DNS 결과 IP (없으면 None)
        dns_ok:      로컬 DNS 해석 성공 여부
        tcp_ok:      TCP 443 연결 성공 여부
        tls_ok:      TLS 핸드셰이크 성공 여부
        http_code:   HTTP 응답 코드 (None이면 요청 미도달)
    """
    # ── 1. DNS 차단 ──────────────────────────────────────────────────────────
    if not dns_ok or not resolved_ip:
        return asdict(BlockDiagnosis(
            blockType="DNS_BLOCKED",
            detail="DNS 조회 실패 — NXDOMAIN, SERVFAIL 또는 타임아웃",
            rawTcpOk=None,
            resolvedIp=resolved_ip or "",
        ))

    # ── 2. IP 차단 / 도메인(SNI) 차단 구분 ──────────────────────────────────
    if not tcp_ok:
        raw_tcp_result = _raw_tcp_ok(hostname)
        if raw_tcp_result:
            # TCP는 됐지만 이미 tcp_ok=False로 들어왔다는 건 논리상 DOMAIN_BLOCKED
            return asdict(BlockDiagnosis(
                blockType="DOMAIN_BLOCKED",
                detail="TCP 성공 후 연결 실패 — 도메인 기반 차단(SNI filtering) 의심",
                rawTcpOk=True,
                resolvedIp=resolved_ip,
            ))
        return asdict(BlockDiagnosis(
            blockType="IP_BLOCKED",
            detail="TCP 연결 실패 — IP 또는 포트 443이 차단됨",
            rawTcpOk=False,
            resolvedIp=resolved_ip,
        ))

    # ── 3. TLS 실패 (TCP는 성공) → 도메인(SNI) 차단 ─────────────────────────
    if not tls_ok:
        return asdict(BlockDiagnosis(
            blockType="DOMAIN_BLOCKED",
            detail="TCP 성공 후 TLS 핸드셰이크 실패 — SNI 기반 도메인 차단",
            rawTcpOk=True,
            resolvedIp=resolved_ip,
        ))

    # ── 4. HTTP 레벨 차단 ────────────────────────────────────────────────────
    if http_code in _CLIENT_BLOCK_CODES:
        label = {
            403: "403 Forbidden — 클라이언트/IP 기반 접근 차단",
            407: "407 Proxy Authentication Required — 프록시 인증 필요",
            451: "451 Unavailable For Legal Reasons — 법적/정책적 차단",
        }.get(http_code, f"HTTP {http_code} — 클라이언트 차단")
        return asdict(BlockDiagnosis(
            blockType="CLIENT_BLOCKED",
            detail=label,
            rawTcpOk=True,
            resolvedIp=resolved_ip,
        ))

    # ── 5. 정상 통과 ─────────────────────────────────────────────────────────
    return asdict(BlockDiagnosis(
        blockType="PASS",
        detail="모든 레이어(DNS/TCP/TLS/HTTP) 정상",
        rawTcpOk=True,
        resolvedIp=resolved_ip,
    ))


if __name__ == "__main__":
    import json, sys, socket as _s
    host = sys.argv[1] if len(sys.argv) > 1 else "api.openai.com"
    try:
        ip = _s.gethostbyname(host)
        d_ok = True
    except Exception:
        ip = None
        d_ok = False

    def _tcp(h):
        try:
            s = _s.create_connection((h, 443), timeout=6)
            s.close(); return True
        except Exception:
            return False

    def _tls(h):
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            s = _s.create_connection((h, 443), timeout=6)
            t = ctx.wrap_socket(s, server_hostname=h)
            t.close(); return True
        except Exception:
            return False

    t_ok = _tcp(host) if d_ok else False
    tls_ok = _tls(host) if t_ok else False
    print(json.dumps(diagnose_block(host, ip, d_ok, t_ok, tls_ok, None), indent=2))
