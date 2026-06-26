"""
Pydantic 응답 모델 — 프론트엔드 types/network.ts와 1:1 대응.
"""

from __future__ import annotations
from pydantic import BaseModel, Field


class DnsRecord(BaseModel):
    type: str
    value: str
    ttl: int


class DnsChainStep(BaseModel):
    server: str
    serverLabel: str
    serverType: str
    query: str
    queryType: str
    responseType: str
    records: list[DnsRecord]
    durationMs: int


class DnsResult(BaseModel):
    hostname: str
    records: list[DnsRecord]
    resolver: str
    durationMs: int
    chain: list[DnsChainStep]


class AsInfo(BaseModel):
    asn: int
    org: str
    country: str
    prefix: str


class GeoPoint(BaseModel):
    lat: float
    lng: float
    label: str


class TraceHop(BaseModel):
    hop: int
    ip: str
    hostname: str | None
    rttMs: list[float]
    location: GeoPoint
    as_: AsInfo | None = None

    class Config:
        populate_by_name = True


class TlsStep(BaseModel):
    step: str
    description: str
    durationMs: int
    detail: str = ""


class CertInfo(BaseModel):
    subject: str
    issuer: str
    serialNumber: str
    validFrom: str
    validUntil: str
    signatureAlgorithm: str
    keyType: str
    san: list[str]
    ocspUrl: str | None
    isRoot: bool
    isTrusted: bool
    spkiFingerprint: str = ""
    certFingerprint: str = ""


class TlsNegotiated(BaseModel):
    version: str
    cipher: str
    handshakeDurationMs: int


class TlsResult(BaseModel):
    steps: list[TlsStep]
    certChain: list[CertInfo]
    negotiated: TlsNegotiated


class HttpHeader(BaseModel):
    name: str
    value: str
    pseudo: bool = False


class HttpResult(BaseModel):
    status: int
    statusText: str
    protocol: str
    durationMs: int
    bodySize: int
    requestHeaders: list[HttpHeader]
    responseHeaders: list[HttpHeader]


class MitmEvidence(BaseModel):
    type: str    # issuer_unknown | proxy_keyword
    detail: str


class MitmResult(BaseModel):
    verdict: str                           # INTERCEPTED | CLEAN | ERROR
    evidence: list[MitmEvidence] = Field(default_factory=list)
    issuerOrg: str = ""
    issuerCN: str = ""
    validityDays: int | None = None


class BlockDiagnosis(BaseModel):
    blockType: str   # PASS | DNS_BLOCKED | IP_BLOCKED | DOMAIN_BLOCKED | CLIENT_BLOCKED | UNKNOWN
    detail: str
    rawTcpOk: bool | None = None
    resolvedIp: str = ""


class NetworkTrace(BaseModel):
    target: str
    client: GeoPoint
    destination: GeoPoint
    dns: DnsResult
    hops: list[dict]  # raw dict — TraceHop 필드명 'as' 충돌 우회
    tls: TlsResult
    http: HttpResult
    totalDurationMs: int
