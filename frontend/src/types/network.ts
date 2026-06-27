export type ConnectionPhase = 'idle' | 'dns' | 'trace' | 'tcp' | 'tls' | 'http' | 'complete'
export type SectionStatus = 'idle' | 'loading' | 'done' | 'error'
export type SectionKey = 'dns' | 'hops' | 'tls' | 'http'

export interface GeoPoint {
  lat: number
  lng: number
  label: string
  ip?: string
}

export interface DnsRecord {
  type: 'A' | 'AAAA' | 'CNAME' | 'NS' | 'SOA' | 'MX'
  value: string
  ttl: number
}

// DNS 재귀 조회 체인: 각 서버에 보낸 쿼리와 받은 응답
export interface DnsChainStep {
  server: string          // 쿼리 대상 서버 IP
  serverLabel: string     // "Root (a.root-servers.net)" 같은 레이블
  serverType: 'recursive' | 'root' | 'tld' | 'authoritative'
  query: string           // 질의한 도메인
  queryType: string       // A, NS, CNAME...
  responseType: 'referral' | 'answer' | 'cached'
  records: DnsRecord[]
  durationMs: number
}

export interface DnsResult {
  hostname: string
  records: DnsRecord[]
  resolver: string
  durationMs: number
  chain: DnsChainStep[]   // 재귀 조회 체인 (Root → TLD → Auth → Result)
}

// Traceroute hop AS 정보
export interface AsInfo {
  asn: number             // AS 번호 (e.g. 13335)
  org: string             // 기관명 (e.g. "CLOUDFLARENET")
  country: string         // ISO 국가코드
  prefix: string          // CIDR prefix (e.g. "104.16.0.0/12")
}

export interface TraceHop {
  hop: number
  ip: string
  hostname?: string
  rttMs: number[]
  location: GeoPoint
  anycast?: boolean       // 애니캐스트 CDN 홉 여부
  as?: AsInfo             // BGP AS 정보 (Python: ipwhois or RIPE API)
}

// TLS 인증서 체인
export interface CertInfo {
  subject: string
  issuer: string
  serialNumber: string
  validFrom: string
  validUntil: string
  signatureAlgorithm: string
  keyType: string         // "RSA 2048", "EC P-256" 등
  san?: string[]          // Subject Alternative Names
  ocspUrl?: string
  isRoot: boolean
  isTrusted: boolean
  spkiFingerprint?: string
  certFingerprint?: string
}

export interface TlsStep {
  step: string             // "ClientHello" | "ServerHello" | "Certificate" | "Finished" | "TCP Connect"
  description: string
  durationMs: number
  detail?: string
}

export interface TlsResult {
  steps: TlsStep[]
  certChain: CertInfo[]   // Root CA → Intermediate → Leaf 순서
  negotiated: {
    version: string
    cipher: string
    handshakeDurationMs: number
  }
  mitm?: MitmResult | null
  blockDiagnosis?: BlockDiagnosis | null
}

// HTTP 요청/응답 헤더
export interface HttpHeader {
  name: string
  value: string
  pseudo?: boolean        // HTTP/2 pseudo-header (:method, :path 등)
}

export interface HttpResult {
  status: number
  statusText: string
  protocol: string        // "HTTP/2", "HTTP/1.1"
  durationMs: number
  requestHeaders: HttpHeader[]
  responseHeaders: HttpHeader[]
  bodySize?: number       // bytes
}

// MITM / 보안 진단
export type MitmVerdict = 'INTERCEPTED' | 'SUSPICIOUS' | 'CLEAN' | 'ERROR'

export interface MitmEvidence {
  type: 'issuer_unknown' | 'proxy_keyword'
  detail: string
}

export interface MitmResult {
  verdict: MitmVerdict
  evidence: MitmEvidence[]
  issuerOrg: string
  issuerCN: string
  validityDays: number | null
}

export type BlockType =
  | 'PASS'
  | 'DNS_BLOCKED'
  | 'IP_BLOCKED'
  | 'DOMAIN_BLOCKED'
  | 'CLIENT_BLOCKED'
  | 'UNKNOWN'

export interface BlockDiagnosis {
  blockType: BlockType
  detail: string
  rawTcpOk: boolean | null
  resolvedIp: string
}

export interface NetworkTrace {
  target: string
  client: GeoPoint
  destination: GeoPoint
  dns: DnsResult
  hops: TraceHop[]
  tls: TlsResult
  http: HttpResult
  totalDurationMs: number
}
