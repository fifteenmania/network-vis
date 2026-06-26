import type { NetworkTrace } from '../../types/network'

export const openaiTrace: NetworkTrace = {
  target: 'api.openai.com',
  client: { lat: 37.5665, lng: 126.978, label: '서울, KR', ip: '220.85.30.1' },
  destination: { lat: 37.3861, lng: -122.0839, label: 'Mountain View, US', ip: '104.18.7.192' },

  // ─────────────────────────────────────────────────────────
  // DNS: 재귀 조회 체인 + 최종 레코드
  // ─────────────────────────────────────────────────────────
  dns: {
    hostname: 'api.openai.com',
    resolver: '8.8.8.8 (Google Public DNS)',
    durationMs: 28,
    records: [
      { type: 'CNAME', value: 'openai.com.cdn.cloudflare.net', ttl: 300 },
      { type: 'A', value: '104.18.7.192', ttl: 300 },
      { type: 'A', value: '104.18.6.192', ttl: 300 },
      { type: 'AAAA', value: '2606:4700::6812:7c0', ttl: 300 },
    ],
    chain: [
      {
        server: '192.168.1.1',
        serverLabel: '로컬 캐시 (OS stub resolver)',
        serverType: 'recursive',
        query: 'api.openai.com',
        queryType: 'A',
        responseType: 'referral',
        records: [],
        durationMs: 0,
      },
      {
        server: '8.8.8.8',
        serverLabel: 'Google 재귀 리졸버',
        serverType: 'recursive',
        query: 'api.openai.com',
        queryType: 'A',
        responseType: 'referral',
        records: [
          { type: 'NS', value: 'a.root-servers.net', ttl: 518400 },
        ],
        durationMs: 3,
      },
      {
        server: '198.41.0.4',
        serverLabel: 'Root NS (a.root-servers.net)',
        serverType: 'root',
        query: 'api.openai.com',
        queryType: 'A',
        responseType: 'referral',
        records: [
          { type: 'NS', value: 'a.gtld-servers.net', ttl: 172800 },
          { type: 'NS', value: 'b.gtld-servers.net', ttl: 172800 },
        ],
        durationMs: 8,
      },
      {
        server: '192.5.6.30',
        serverLabel: '.com TLD NS (a.gtld-servers.net)',
        serverType: 'tld',
        query: 'api.openai.com',
        queryType: 'A',
        responseType: 'referral',
        records: [
          { type: 'NS', value: 'ben.ns.cloudflare.com', ttl: 172800 },
          { type: 'NS', value: 'uma.ns.cloudflare.com', ttl: 172800 },
        ],
        durationMs: 13,
      },
      {
        server: '108.162.192.1',
        serverLabel: 'Authoritative NS (ben.ns.cloudflare.com)',
        serverType: 'authoritative',
        query: 'api.openai.com',
        queryType: 'A',
        responseType: 'answer',
        records: [
          { type: 'CNAME', value: 'openai.com.cdn.cloudflare.net', ttl: 300 },
          { type: 'A', value: '104.18.7.192', ttl: 300 },
          { type: 'A', value: '104.18.6.192', ttl: 300 },
        ],
        durationMs: 22,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // Traceroute: hop별 AS 정보 추가
  // ─────────────────────────────────────────────────────────
  hops: [
    {
      hop: 1,
      ip: '192.168.1.1',
      hostname: 'home-router.local',
      rttMs: [1.2, 1.3, 1.1],
      location: { lat: 37.5665, lng: 126.978, label: '서울, KR' },
    },
    {
      hop: 2,
      ip: '61.33.27.1',
      hostname: 'kr-isp-gw.kt.net',
      rttMs: [4.5, 4.8, 4.3],
      location: { lat: 37.5519, lng: 126.9918, label: '서울, KR' },
      as: { asn: 4766, org: 'Korea Telecom', country: 'KR', prefix: '61.32.0.0/11' },
    },
    {
      hop: 3,
      ip: '112.174.50.1',
      hostname: 'kr-backbone.kt.net',
      rttMs: [7.2, 7.1, 7.4],
      location: { lat: 37.4563, lng: 126.7052, label: '인천, KR' },
      as: { asn: 4766, org: 'Korea Telecom', country: 'KR', prefix: '112.168.0.0/13' },
    },
    {
      hop: 4,
      ip: '203.248.240.1',
      hostname: 'sea-ix.kt.net',
      rttMs: [18.5, 18.9, 18.2],
      location: { lat: 47.6062, lng: -122.3321, label: 'Seattle, US' },
      as: { asn: 4766, org: 'Korea Telecom', country: 'US', prefix: '203.248.240.0/24' },
    },
    {
      hop: 5,
      ip: '141.101.72.1',
      hostname: 'sea-cf.cloudflare.com',
      rttMs: [20.1, 20.3, 19.9],
      location: { lat: 47.6062, lng: -122.3321, label: 'Seattle, US' },
      as: { asn: 13335, org: 'CLOUDFLARENET', country: 'US', prefix: '141.101.64.0/18' },
    },
    {
      hop: 6,
      ip: '172.70.200.1',
      hostname: 'sfo-cf.cloudflare.com',
      rttMs: [26.4, 26.7, 26.1],
      location: { lat: 37.6213, lng: -122.379, label: 'San Francisco, US' },
      as: { asn: 13335, org: 'CLOUDFLARENET', country: 'US', prefix: '172.70.192.0/22' },
    },
    {
      hop: 7,
      ip: '104.18.7.192',
      hostname: 'api.openai.com',
      rttMs: [28.9, 29.1, 28.7],
      location: { lat: 37.3861, lng: -122.0839, label: 'Mountain View, US' },
      as: { asn: 13335, org: 'CLOUDFLARENET', country: 'US', prefix: '104.16.0.0/12' },
    },
  ],

  // ─────────────────────────────────────────────────────────
  // TLS: handshake 단계 + 인증서 체인
  // ─────────────────────────────────────────────────────────
  tls: {
    steps: [
      {
        step: 'TCP Connect',
        description: 'TCP 연결 → api.openai.com:443',
        durationMs: 12,
        detail: '',
      },
      {
        step: 'ClientHello',
        description: '클라이언트 Hello 전송 (SNI: api.openai.com)',
        durationMs: 4,
        detail: 'Supported versions, cipher suites, extensions',
      },
      {
        step: 'ServerHello',
        description: '서버 Hello 수신 → TLSv1.3',
        durationMs: 4,
        detail: 'Cipher: TLS_AES_256_GCM_SHA384',
      },
      {
        step: 'Certificate',
        description: '서버 인증서 체인 수신',
        durationMs: 4,
        detail: '',
      },
      {
        step: 'Finished',
        description: '핸드셰이크 완료 — 암호화 채널 수립',
        durationMs: 4,
        detail: 'Key bits: 256',
      },
    ],
    certChain: [
      {
        subject: 'CN=GTS Root R1, O=Google Trust Services LLC, C=US',
        issuer: 'Self-signed',
        serialNumber: '6e:47:a9:6a:13:0d:0e:a5',
        validFrom: '2016-06-22',
        validUntil: '2036-06-22',
        signatureAlgorithm: 'SHA-256 with RSA Encryption',
        keyType: 'RSA 4096',
        isRoot: true,
        isTrusted: true,
      },
      {
        subject: 'CN=WE1, O=Google Trust Services, C=US',
        issuer: 'CN=GTS Root R1, O=Google Trust Services LLC, C=US',
        serialNumber: '1a:3b:9f:2c:88:d4:e1:07',
        validFrom: '2023-11-13',
        validUntil: '2029-02-20',
        signatureAlgorithm: 'SHA-256 with RSA Encryption',
        keyType: 'EC P-256',
        ocspUrl: 'http://ocsp.pki.goog/r1',
        isRoot: false,
        isTrusted: true,
      },
      {
        subject: 'CN=*.openai.com',
        issuer: 'CN=WE1, O=Google Trust Services, C=US',
        serialNumber: '5f:2a:99:c8:3d:e0:17:4b',
        validFrom: '2025-06-17',
        validUntil: '2025-09-15',
        signatureAlgorithm: 'ECDSA with SHA-256',
        keyType: 'EC P-256',
        san: ['openai.com', '*.openai.com', 'api.openai.com'],
        ocspUrl: 'http://ocsp.pki.goog/we1',
        isRoot: false,
        isTrusted: true,
      },
    ],
    negotiated: {
      version: 'TLSv1.3',
      cipher: 'TLS_AES_256_GCM_SHA384',
      handshakeDurationMs: 16,
    },
  },

  // ─────────────────────────────────────────────────────────
  // HTTP: 요청·응답 헤더 + HTTP/2 pseudo-headers
  // ─────────────────────────────────────────────────────────
  http: {
    status: 200,
    statusText: 'OK',
    protocol: 'HTTP/2',
    durationMs: 42,
    bodySize: 8192,
    requestHeaders: [
      { name: ':method', value: 'GET', pseudo: true },
      { name: ':path', value: '/v1/models', pseudo: true },
      { name: ':scheme', value: 'https', pseudo: true },
      { name: ':authority', value: 'api.openai.com', pseudo: true },
      { name: 'user-agent', value: 'curl/8.4.0' },
      { name: 'accept', value: '*/*' },
      { name: 'authorization', value: 'Bearer sk-***...***' },
    ],
    responseHeaders: [
      { name: ':status', value: '200', pseudo: true },
      { name: 'content-type', value: 'application/json' },
      { name: 'content-encoding', value: 'br' },
      { name: 'cf-ray', value: '8a3f2c1d4e5b6a7c-ICN' },
      { name: 'cf-cache-status', value: 'DYNAMIC' },
      { name: 'server', value: 'cloudflare' },
      { name: 'alt-svc', value: 'h3=":443"; ma=86400' },
      { name: 'strict-transport-security', value: 'max-age=31536000; includeSubDomains' },
      { name: 'x-request-id', value: 'req_abc123def456' },
      { name: 'openai-processing-ms', value: '38' },
    ],
  },

  totalDurationMs: 351,
}
