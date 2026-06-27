import { useTraceStore } from '../../store/traceStore'
import type { SectionStatus } from '../../types/network'
import {
  extractRoutePath,
  isDnsCached,
  getDnsCacheMs,
  extractUserAgent,
  extractLanguage,
  parseUserAgent,
  getFirewallView,
  type FirewallTone,
} from '../../utils/observerView'
import styles from './PanelShell.module.css'
import s from './ObserverPanel.module.css'

// ── 툴팁 ─────────────────────────────────────────────────────────────────────

function Tip({ text, align = 'center' }: { text: string; align?: 'left' | 'center' | 'right' }) {
  return (
    <span className={s.tipWrap} data-align={align}>
      <span className={s.tipIcon}>ℹ</span>
      <span className={s.tipBox}>{text}</span>
    </span>
  )
}

// ── "본다" 행 (노출되는 항목) ─────────────────────────────────────────────────

function SeesRow({
  label,
  value,
  tip,
}: {
  label: string
  value: string
  tip?: string
}) {
  return (
    <div className={s.seesRow}>
      <span className={s.seesMark}>▸</span>
      <span className={s.rowLabel}>
        {label}
        {tip && <Tip text={tip} />}
      </span>
      <span className={s.rowValue}>{value}</span>
    </div>
  )
}

// ── "못 본다" 행 (암호화로 가려지는 항목) ─────────────────────────────────────

function HiddenRow({ text }: { text: string }) {
  return (
    <div className={s.hiddenRow}>
      <span className={s.hiddenMark}>×</span>
      <span className={s.hiddenText}>{text}</span>
    </div>
  )
}

function Group({ kind, children }: { kind: 'sees' | 'hidden'; children: React.ReactNode }) {
  return (
    <div className={s.group}>
      <span className={kind === 'sees' ? s.groupSees : s.groupHidden}>
        {kind === 'sees' ? '본다' : '못 본다'}
      </span>
      <div className={s.groupRows}>{children}</div>
    </div>
  )
}

// ── 관찰자 카드 ───────────────────────────────────────────────────────────────

function ObserverCard({
  title,
  subtitle,
  badge,
  badgeTone,
  children,
}: {
  title: string
  subtitle: string
  badge?: string
  badgeTone?: FirewallTone
  children: React.ReactNode
}) {
  return (
    <div className={s.card}>
      <div className={s.cardHeader}>
        <span className={s.cardTitle}>{title}</span>
        {badge && (
          <span className={`${s.cardBadge} ${badgeTone ? s[badgeTone] : ''}`}>{badge}</span>
        )}
      </div>
      <div className={s.cardSubtitle}>{subtitle}</div>
      <div className={s.cardBody}>{children}</div>
    </div>
  )
}

// ── 스켈레톤 ─────────────────────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      {[90, 70, 80, 60].map((w, i) => (
        <div key={i} className={styles.skeletonLine} style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────────

export default function ObserverPanel() {
  const {
    target,
    client,
    dns, dnsStatus,
    hops, hopsStatus,
    tls, tlsStatus,
    http, httpStatus,
  } = useTraceStore()

  const anyActive =
    dnsStatus !== 'idle' || hopsStatus !== 'idle' ||
    tlsStatus !== 'idle' || httpStatus !== 'idle'

  if (!anyActive) return null

  const allLoading =
    dnsStatus === 'loading' && hopsStatus === 'loading' &&
    tlsStatus === 'loading' && httpStatus === 'loading' &&
    !dns && !hops && !tls && !http

  const allDone =
    dnsStatus === 'done' && hopsStatus === 'done' &&
    tlsStatus === 'done' && httpStatus === 'done'
  const panelStatus: SectionStatus = allDone ? 'done' : 'loading'

  // ── 데이터 추출 ────────────────────────────────────────────────────────────

  const sni = target ?? null
  const destIp = tls?.blockDiagnosis?.resolvedIp || null
  const routePath = hops ? extractRoutePath(hops) : []

  const cached = dns ? isDnsCached(dns.chain) : null
  const cacheMs = dns ? getDnsCacheMs(dns.chain) : null
  const dnsRecords = dns?.records ?? []
  const ttl = dnsRecords.find(r => r.type === 'A' || r.type === 'AAAA')?.ttl ?? null

  const clientIp = client?.ip ?? null
  const ua = http ? extractUserAgent(http.requestHeaders) : null
  const lang = http ? extractLanguage(http.requestHeaders) : null
  const uaParsed = ua ? parseUserAgent(ua) : null

  const firewallView = tlsStatus === 'done' ? getFirewallView(tls?.mitm?.verdict) : null

  const panelClass = panelStatus === 'loading' ? styles.loading : styles.done

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      {/* 헤더 */}
      <div className={styles.header}>
        <span className={styles.title}>보안 담당자 시점</span>
        {panelStatus === 'loading' && <span className={styles.spinner} />}
      </div>

      {allLoading && <SkeletonBody />}

      {!allLoading && (
        <div className={s.body}>
          <div className={s.intro}>
            이 HTTPS 연결에서 <strong>위치별 관찰자</strong>가 실제로 무엇을 보고 무엇을 못 보는지.
          </div>

          {/* ── 관찰자 1: 경로상 관찰자 ── */}
          <ObserverCard
            title="경로상 관찰자"
            subtitle="같은 와이파이 · ISP · 경유 통신사 · 기업 방화벽 (복호화 안 함)"
          >
            <Group kind="sees">
              {sni ? (
                <SeesRow
                  label="접속 도메인"
                  value={sni}
                  tip={'SNI(Server Name Indication)\n\nTLS 핸드셰이크의 ClientHello 에 도메인 이름이 평문으로 담겨 전송됩니다. 내용은 암호화돼도 "어디에 접속하는지"는 경로상 누구나 볼 수 있습니다. (ECH 가 적용되면 가려짐)'}
                />
              ) : (
                <div className={s.waiting}>대기 중...</div>
              )}

              {destIp ? (
                <SeesRow
                  label="목적지 IP"
                  value={destIp}
                  tip={'IP 패킷 헤더의 목적지 주소입니다. 암호화 대상이 아니므로 경로상 모든 장비가 봅니다.'}
                />
              ) : tlsStatus === 'loading' ? (
                <div className={s.waiting}>IP 확인 중...</div>
              ) : null}

              <SeesRow
                label="트래픽 패턴"
                value="접속 시각 · 통신량 · 지속 시간"
              />
            </Group>

            {routePath.length > 0 && (
              <div className={s.routeNote}>
                <span className={s.routeLabel}>
                  이 구간을 지나는 망
                  <Tip text={'이 경로의 각 통신사/조직이 위 항목을 볼 수 있는 잠재적 관찰자입니다.\n\n경로는 측정 서버 기준 traceroute 결과이며, 실제 사용자 위치에서는 다를 수 있습니다.'} />
                </span>
                <span className={s.routeValue}>
                  {routePath.map(r => r.label).join('  →  ')}
                </span>
              </div>
            )}

            <Group kind="hidden">
              <HiddenRow text="URL 경로 · 페이지 내용" />
              <HiddenRow text="검색어 · 폼 입력값" />
              <HiddenRow text="쿠키 · 세션 데이터" />
            </Group>
          </ObserverCard>

          {/* ── 관찰자 2: DNS 리졸버 ── */}
          {(dnsStatus === 'done' || dnsStatus === 'loading') && (
            <ObserverCard
              title="DNS 리졸버"
              subtitle="ISP DNS 또는 사내 DNS 서버 (도메인 조회를 대신 처리)"
            >
              {dns ? (
                <>
                  <Group kind="sees">
                    <SeesRow
                      label="조회 도메인"
                      value={`${dns.hostname} (조회 시각 포함)`}
                      tip={'리졸버는 내가 어떤 도메인을 물었는지와 그 시각을 기록합니다.\n\n평문 DNS(Do53)면 경로상 관찰자도 이 질의를 볼 수 있고, DoH/DoT 면 리졸버만 봅니다.'}
                    />
                  </Group>

                  <Group kind="hidden">
                    <HiddenRow text="실제 연결 내용 · 어떤 페이지를 봤는지" />
                  </Group>

                  {cacheMs !== null && (
                    <div className={s.metaNote}>
                      참고: 응답 {cacheMs}ms {cached ? '(캐시 적중)' : '(신규 조회)'}
                      {ttl !== null && ` · TTL ${ttl}s`}
                    </div>
                  )}
                </>
              ) : (
                <div className={s.waiting}>DNS 조회 중...</div>
              )}
            </ObserverCard>
          )}

          {/* ── 관찰자 3: 목적지 서버 ── */}
          {(httpStatus === 'done' || httpStatus === 'loading' || tlsStatus === 'done') && (
            <ObserverCard
              title="목적지 서버"
              subtitle="접속하려는 서버 — TLS 종단이라 전부 복호화"
            >
              <Group kind="sees">
                {clientIp ? (
                  <SeesRow
                    label="내 실제 IP"
                    value={clientIp}
                    tip={'TCP 연결의 출발지 주소로, 서버는 항상 접속자의 공인 IP 를 압니다.\n\n(측정 서버가 관측한 공인 IP 입니다.)'}
                  />
                ) : (
                  <div className={s.waiting}>IP 확인 중...</div>
                )}

                {uaParsed ? (
                  <SeesRow label="브라우저 / OS" value={`${uaParsed.browser} / ${uaParsed.os}`} />
                ) : httpStatus === 'loading' ? (
                  <div className={s.waiting}>요청 헤더 수집 중...</div>
                ) : null}

                {lang && <SeesRow label="언어 설정" value={lang} />}

                <SeesRow
                  label="콘텐츠 전부"
                  value="URL · 검색어 · 폼 입력 · 쿠키 · 본문"
                  tip={'서버는 TLS 의 종단(end point)이므로 클라이언트가 보낸 모든 데이터를 복호화해서 받습니다. 가려지는 것은 없습니다.'}
                />
              </Group>
            </ObserverCard>
          )}

          {/* ── 관찰자 4: 기업 방화벽 (SSL Inspection) ── */}
          {firewallView && (
            <ObserverCard
              title="기업 방화벽 (SSL Inspection)"
              subtitle="경로상에 있지만 TLS 를 풀어볼 수 있는 특수 관찰자"
              badge={firewallView.label}
              badgeTone={firewallView.tone}
            >
              <div className={`${s.firewallSummary} ${s[firewallView.tone]}`}>
                {firewallView.summary}
              </div>
            </ObserverCard>
          )}

          {/* ── 요약 ── */}
          <div className={s.footer}>
            <span className={s.footerMark}>요점</span>
            <span className={s.footerText}>
              페이지 내용 · 검색어 · 쿠키는 TLS 로 암호화되어 <strong>경로상 관찰자에게는 가려집니다</strong>.
              단, 목적지 서버는 복호화해 전부 보고, SSL Inspection 이 켜진 방화벽도 동일하게 봅니다.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
