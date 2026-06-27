import type { TraceHop, DnsChainStep, HttpHeader, MitmVerdict } from '../types/network'

/**
 * Traceroute hop 시퀀스에서 경유 경로를 추출합니다.
 * 연속으로 같은 ASN이 반복되는 hop은 하나로 합칩니다.
 * 예: [KR(SK), KR(SK), JP(NTT), JP(NTT), US(Google)] → ["KR · SK Broadband", "JP · NTT", "US · Google"]
 */
export function extractRoutePath(hops: TraceHop[]): { label: string; country: string; org: string }[] {
  const result: { label: string; country: string; org: string }[] = []
  let lastAsn: number | null = null

  for (const hop of hops) {
    if (!hop.as || !hop.as.asn) continue
    if (hop.as.asn === lastAsn) continue
    lastAsn = hop.as.asn

    const country = hop.as.country || '?'
    const org = hop.as.org || `AS${hop.as.asn}`
    result.push({ label: `${country} · ${org}`, country, org })
  }

  return result
}

/**
 * DNS 체인의 로컬 캐시 단계를 보고 이 도메인이 이미 캐시됐는지 판단합니다.
 * responseType === 'cached' 또는 durationMs < 10ms 이면 캐시된 것으로 봅니다.
 */
export function isDnsCached(chain: DnsChainStep[]): boolean {
  if (!chain || chain.length === 0) return false
  const localStep = chain[0]
  return localStep.responseType === 'cached' || localStep.durationMs < 10
}

/**
 * DNS 체인에서 로컬 캐시 응답 시간을 반환합니다.
 */
export function getDnsCacheMs(chain: DnsChainStep[]): number {
  if (!chain || chain.length === 0) return 0
  return chain[0].durationMs
}

/**
 * HTTP 요청 헤더 목록에서 User-Agent 값을 반환합니다.
 */
export function extractUserAgent(headers: HttpHeader[]): string | null {
  if (!headers) return null
  const h = headers.find(h => h.name.toLowerCase() === 'user-agent')
  return h?.value ?? null
}

/**
 * HTTP 요청 헤더 목록에서 Accept-Language 값을 반환합니다.
 */
export function extractLanguage(headers: HttpHeader[]): string | null {
  if (!headers) return null
  const h = headers.find(h => h.name.toLowerCase() === 'accept-language')
  return h?.value ?? null
}

/**
 * SSL Inspection(방화벽 복호화) 판정에 따른 "방화벽이 무엇을 보는가" 시야 매핑.
 *
 * SecurityPanel 의 MitmVerdict 와 의미를 일치시킵니다:
 * - INTERCEPTED: 방화벽이 TLS 를 풀어 목적지 서버와 동일하게 전부 봄
 * - SUSPICIOUS:  복호화 중일 가능성 (인증서 의심)
 * - CLEAN:       복호화 흔적 없음 — 경로상 관찰자 수준만 봄
 * - ERROR/없음:  판정 불가 → null (섹션 미표시)
 */
export type FirewallTone = 'danger' | 'warn' | 'green'

export interface FirewallView {
  label: string
  tone: FirewallTone
  summary: string
}

export function getFirewallView(
  verdict: MitmVerdict | null | undefined,
): FirewallView | null {
  switch (verdict) {
    case 'INTERCEPTED':
      return {
        label: 'SSL Inspection 감지',
        tone: 'danger',
        summary:
          '방화벽이 TLS 를 복호화하고 있습니다. 목적지 서버와 동일하게 페이지 내용 · 검색어 · 쿠키까지 전부 봅니다.',
      }
    case 'SUSPICIOUS':
      return {
        label: '인증서 의심',
        tone: 'warn',
        summary:
          '인증서 발급 기관이 알려진 공개 CA 목록에 없습니다. 방화벽이 복호화 중일 가능성이 있습니다. (정상 CA 누락 가능성도 있음)',
      }
    case 'CLEAN':
      return {
        label: '복호화 없음',
        tone: 'green',
        summary:
          'SSL Inspection 흔적이 없습니다. 경로상 관찰자 수준(도메인 · IP)만 보이고 실제 내용은 가려집니다.',
      }
    default:
      return null
  }
}

/**
 * User-Agent 문자열에서 브라우저/OS를 간략히 추론합니다.
 */
export function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = 'Unknown'
  let os = 'Unknown'

  if (/Edg\//.test(ua))        browser = 'Edge'
  else if (/OPR\//.test(ua))   browser = 'Opera'
  else if (/Chrome\//.test(ua)) browser = 'Chrome'
  else if (/Firefox\//.test(ua)) browser = 'Firefox'
  else if (/Safari\//.test(ua)) browser = 'Safari'
  else if (/curl\//.test(ua))   browser = 'curl'
  else if (/python/.test(ua.toLowerCase())) browser = 'Python httpx'

  if (/Windows/.test(ua))      os = 'Windows'
  else if (/Macintosh/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua))    os = 'Linux'
  else if (/Android/.test(ua))  os = 'Android'
  else if (/iPhone|iPad/.test(ua)) os = 'iOS'

  return { browser, os }
}
