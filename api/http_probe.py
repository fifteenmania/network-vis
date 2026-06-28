"""
HTTP/2 헤더 캡처 — httpx 비동기 클라이언트 사용.
요청/응답 헤더를 pseudo-header 포함 구조로 반환합니다.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, asdict


@dataclass
class HttpHeader:
    name: str
    value: str
    pseudo: bool = False


@dataclass
class HttpResult:
    status: int
    statusText: str
    protocol: str
    durationMs: int
    bodySize: int
    requestHeaders: list[HttpHeader]
    responseHeaders: list[HttpHeader]


_STATUS_TEXT: dict[int, str] = {
    200: "OK", 201: "Created", 204: "No Content",
    301: "Moved Permanently", 302: "Found", 304: "Not Modified",
    400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
    404: "Not Found", 429: "Too Many Requests",
    500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
}


def _is_pseudo(name: str) -> bool:
    return name.startswith(":")


def _verify_ctx():
    """
    httpx 검증에 사용할 컨텍스트를 반환합니다.

    사내망 SSL Inspection 환경에서는 사내 CA가 OS 신뢰저장소에만 설치돼 있어
    공개 번들(certifi)만으로는 검증이 실패합니다. truststore로 OS 신뢰저장소를
    사용하면 브라우저처럼 동작해 실제 HTTP 상태를 확인할 수 있습니다.
    truststore 미설치 시 기본 검증(True)으로 폴백합니다.
    """
    try:
        import ssl
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return True


def _build_request_headers(url: str, extra: dict) -> list[HttpHeader]:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    headers = [
        HttpHeader(name=":method",    value="GET",                  pseudo=True),
        HttpHeader(name=":scheme",    value=parsed.scheme,          pseudo=True),
        HttpHeader(name=":authority", value=parsed.netloc,          pseudo=True),
        HttpHeader(name=":path",      value=parsed.path or "/",     pseudo=True),
    ]
    for k, v in extra.items():
        headers.append(HttpHeader(name=k.lower(), value=v, pseudo=False))
    return headers


async def probe_http(url: str) -> dict:
    """
    URL에 HTTP/2 GET 요청을 보내고 HttpResult dict를 반환합니다.
    """
    import httpx

    req_extra = {
        "accept": "*/*",
        "accept-encoding": "gzip, deflate, br",
        "user-agent": "network-vis/1.0 (educational tracer)",
    }

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(
            http2=True,
            follow_redirects=True,
            timeout=15,
            verify=_verify_ctx(),
        ) as client:
            response = await client.get(url, headers=req_extra)
            duration_ms = int((time.perf_counter() - t0) * 1000)

            protocol = response.http_version  # "HTTP/2" or "HTTP/1.1"
            status = response.status_code
            body_size = len(response.content)

            # 요청 헤더 (pseudo + 실제)
            request_headers = _build_request_headers(str(response.url), req_extra)

            # 응답 헤더 (pseudo :status 포함)
            response_headers = [
                HttpHeader(name=":status", value=str(status), pseudo=True),
            ]
            for k, v in response.headers.items():
                response_headers.append(HttpHeader(name=k.lower(), value=v, pseudo=False))

    except Exception as e:
        duration_ms = int((time.perf_counter() - t0) * 1000)
        result = HttpResult(
            status=0, statusText=str(e), protocol="unknown",
            durationMs=duration_ms, bodySize=0,
            requestHeaders=[], responseHeaders=[],
        )
        return asdict(result)

    result = HttpResult(
        status=status,
        statusText=_STATUS_TEXT.get(status, ""),
        protocol=protocol,
        durationMs=duration_ms,
        bodySize=body_size,
        requestHeaders=request_headers,
        responseHeaders=response_headers,
    )
    return asdict(result)


if __name__ == "__main__":
    import json, sys
    url = sys.argv[1] if len(sys.argv) > 1 else "https://api.openai.com"
    result = asyncio.run(probe_http(url))
    print(json.dumps(result, indent=2))
