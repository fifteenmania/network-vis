import { useState } from 'react'
import type { MitmResult, MitmVerdict, BlockDiagnosis, BlockType, SectionStatus } from '../../types/network'
import styles from './PanelShell.module.css'
import s from './SecurityPanel.module.css'

interface Props {
  mitm?: MitmResult | null
  blockDiagnosis?: BlockDiagnosis | null
  status: SectionStatus
}

// ── 툴팁 컴포넌트 ─────────────────────────────────────────────────────────────

function Tip({ text, align = 'center' }: { text: string; align?: 'left' | 'center' | 'right' }) {
  return (
    <span className={s.tipWrap} data-align={align}>
      <span className={s.tipIcon}>ℹ</span>
      <span className={s.tipBox}>{text}</span>
    </span>
  )
}

// ── 연결 흐름도 ───────────────────────────────────────────────────────────────

const FLOW_STEPS = [
  {
    id: 'DNS',
    label: 'DNS',
    tip: '도메인 이름(예: api.openai.com)을 서버 IP로 변환하는 단계입니다.\n\n실패하면 주소 자체를 찾지 못합니다. 방화벽이 특정 도메인의 주소 조회를 막은 것입니다.',
  },
  {
    id: 'TCP',
    label: 'TCP',
    tip: 'DNS로 얻은 IP에 실제로 문을 두드리는 단계입니다. (포트 443)\n\n실패하면 서버 IP 자체, 또는 포트가 방화벽에 막힌 것입니다.',
  },
  {
    id: 'TLS',
    label: 'TLS',
    tip: '연결에 자물쇠를 채우는 단계입니다. 이때 SNI(접속하려는 도메인 이름)가 서버로 전달됩니다.\n\nTCP는 됐지만 TLS가 실패하면 IP가 아닌 도메인 이름이 차단된 것입니다.',
  },
  {
    id: 'HTTP',
    label: 'HTTP',
    tip: '암호화된 채널 위에서 실제 요청을 주고받는 단계입니다.\n\nTLS까지 됐지만 HTTP에서 403/407/451이 오면 서버 또는 프록시가 이 클라이언트를 거부한 것입니다.',
  },
]

const BLOCK_FAIL_INDEX: Record<BlockType, number> = {
  DNS_BLOCKED:    0,
  IP_BLOCKED:     1,
  DOMAIN_BLOCKED: 2,
  CLIENT_BLOCKED: 3,
  PASS:           4,
  UNKNOWN:       -1,
}

function FlowIndicator({ blockType }: { blockType: BlockType }) {
  const failAt = BLOCK_FAIL_INDEX[blockType] ?? -1

  return (
    <div className={s.flow}>
      {FLOW_STEPS.map((step, i) => {
        const passed = failAt === -1 ? false : i < failAt
        const failed = i === failAt
        const allPass = blockType === 'PASS'
        const cls = allPass ? s.flowPass
          : passed ? s.flowPass
          : failed ? s.flowFail
          : s.flowDim

        return (
          <div key={step.id} className={s.flowItem}>
            <div className={`${s.flowStep} ${cls}`}>
              <span className={s.flowDot}>
                {(allPass || passed) ? '✓' : failed ? '✕' : '·'}
              </span>
              <span className={s.flowLabel}>{step.label}</span>
            </div>
            <Tip text={step.tip} align="center" />
            {i < FLOW_STEPS.length - 1 && (
              <span className={`${s.flowArrow} ${(allPass || passed) ? s.flowArrowPass : ''}`}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 차단 유형 텍스트 ─────────────────────────────────────────────────────────

const BLOCK_VERDICT_META: Record<BlockType, { label: string; cls: string; icon: string; summary: string }> = {
  PASS: {
    label: 'PASS', cls: 'blockPass', icon: '✓',
    summary: '모든 연결 단계를 통과했습니다.',
  },
  DNS_BLOCKED: {
    label: 'DNS 차단', cls: 'blockBlocked', icon: '✕',
    summary: '도메인 이름 조회 자체가 차단됐습니다. IT 부서가 이 주소를 금지 목록에 올린 상태입니다.',
  },
  IP_BLOCKED: {
    label: 'IP 차단', cls: 'blockBlocked', icon: '✕',
    summary: '서버 IP로의 연결이 차단됐습니다. 방화벽이 목적지 서버 자체를 막고 있습니다.',
  },
  DOMAIN_BLOCKED: {
    label: '도메인 차단 (SNI)', cls: 'blockBlocked', icon: '✕',
    summary: 'TCP 연결은 됐지만 도메인 이름이 전달되는 순간 차단됐습니다. SNI 기반 필터링입니다.',
  },
  CLIENT_BLOCKED: {
    label: '클라이언트 차단', cls: 'blockWarn', icon: '⚠',
    summary: '서버까지 도달했지만 HTTP 수준에서 거부당했습니다. 이 PC 또는 IP가 차단 목록에 있을 수 있습니다.',
  },
  UNKNOWN: {
    label: '알 수 없음', cls: 'blockUnknown', icon: '?',
    summary: '차단 여부를 판별하기 어렵습니다.',
  },
}

function BlockSection({ block }: { block: BlockDiagnosis }) {
  const meta = BLOCK_VERDICT_META[block.blockType as BlockType] ?? BLOCK_VERDICT_META.UNKNOWN

  return (
    <div className={s.section}>
      {/* 섹션 헤더 */}
      <div className={s.sectionRow}>
        <span className={s.sectionLabel}>
          연결 차단
          <Tip
            align="left"
            text={"인터넷 연결은 DNS → TCP → TLS → HTTP 순서로 이루어집니다.\n\n어느 단계에서 막혔는지 파악하면 방화벽 규칙의 종류를 추정할 수 있습니다."}
          />
        </span>
        <span className={`${s.verdict} ${s[meta.cls]}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      {/* 흐름도 */}
      <FlowIndicator blockType={block.blockType as BlockType} />

      {/* 요약 */}
      {block.blockType !== 'PASS' && (
        <div className={s.summary}>{meta.summary}</div>
      )}

      {/* 상세 (detail) */}
      {block.detail && block.blockType !== 'PASS' && (
        <div className={s.blockDetail}>{block.detail}</div>
      )}

      {/* 기술 정보 */}
      <div className={s.infoGrid}>
        {block.resolvedIp && (
          <div className={s.infoRow}>
            <span className={s.infoKey}>
              Resolved IP
              <Tip text={"DNS가 이 도메인에 대해 반환한 실제 서버 IP 주소입니다.\n\n이 IP로 TCP 연결을 시도합니다."} />
            </span>
            <span className={s.infoVal}>{block.resolvedIp}</span>
          </div>
        )}
        {block.rawTcpOk !== null && block.rawTcpOk !== undefined && (
          <div className={s.infoRow}>
            <span className={s.infoKey}>
              Raw TCP
              <Tip text={"SNI(도메인 이름) 없이 순수 IP로만 연결한 결과입니다.\n\nRaw TCP가 성공하고 TLS가 실패하면, IP 자체는 허용됐지만 도메인 이름이 차단된 것(SNI 필터링)입니다."} />
            </span>
            <span className={s.infoVal}>{block.rawTcpOk ? '성공' : '실패'}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── SSL Inspection 섹션 ───────────────────────────────────────────────────────

const MITM_VERDICT_META: Record<MitmVerdict, { label: string; cls: string; icon: string; summary: string }> = {
  INTERCEPTED: {
    label: 'SSL Inspection 감지', cls: 'verdictIntercepted', icon: '✕',
    summary: '방화벽이 암호화된 통신을 열어보고 있습니다. API 키, 메시지 등 전송 내용이 방화벽 장비를 통해 복호화됩니다.',
  },
  SUSPICIOUS: {
    label: '인증서 의심', cls: 'verdictSuspicious', icon: '⚠',
    summary: '인증서 발급 기관이 알려진 공개 CA 목록에 없습니다. 방화벽 개입일 수 있지만, 목록에 등록되지 않은 정상 CA일 가능성도 있습니다. Issuer 이름을 직접 확인하세요.',
  },
  CLEAN: {
    label: 'CLEAN', cls: 'verdictClean', icon: '✓',
    summary: '인증서가 신뢰할 수 있는 공개 CA에서 발급됐습니다. 방화벽의 SSL Inspection 흔적이 없습니다.',
  },
  ERROR: {
    label: 'ERROR', cls: 'verdictError', icon: '!',
    summary: 'TLS 연결 또는 인증서 파싱에 실패했습니다.',
  },
}

const EVIDENCE_META: Record<string, { label: string; explain: string }> = {
  issuer_unknown: {
    label: 'Issuer 미확인',
    explain: '인증서를 발급한 기관(CA)이 알려진 공개 CA 목록에 없습니다.\n\n공개 CA(DigiCert, Let\'s Encrypt, Google Trust Services 등)는 인터넷 표준으로 검증된 기관입니다. 기업 방화벽이 SSL Inspection을 할 때는 자체 내부 CA로 즉석 발급하므로 이 목록에 없게 됩니다.\n\n단, 목록이 완전하지 않아 정상 공개 CA가 누락됐을 가능성도 있습니다. Issuer 이름을 직접 검색해 확인하세요.',
  },
  proxy_keyword: {
    label: '프록시 키워드 (확정)',
    explain: '인증서 발급 기관(Issuer) 이름에 방화벽/프록시 제품명이 포함돼 있습니다.\n\nZscaler, Palo Alto, Fortinet 등 SSL Inspection 제품은 인증서를 발급할 때 자사 이름을 Issuer에 포함하는 경우가 많습니다.\n\n→ 해당 보안 제품이 이 연결에서 SSL Inspection을 수행 중입니다. 이 증거는 오탐 가능성이 매우 낮습니다.',
  },
}

function EvidenceItem({ type, detail }: { type: string; detail: string }) {
  const [open, setOpen] = useState(false)
  const meta = EVIDENCE_META[type] ?? { label: type, explain: detail }

  return (
    <div className={s.evidenceItem}>
      <button
        className={s.evidenceHeader}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className={s.evidenceType}>{meta.label}</span>
        <span className={s.evidenceBrief}>{detail}</span>
        <span className={s.evidenceChevron}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className={s.evidenceBody}>
          {meta.explain.split('\n').map((line, i) =>
            line === '' ? <br key={i} /> : <p key={i}>{line}</p>
          )}
        </div>
      )}
    </div>
  )
}

function MitmSection({ mitm }: { mitm: MitmResult }) {
  const meta = MITM_VERDICT_META[mitm.verdict as MitmVerdict] ?? MITM_VERDICT_META.ERROR
  const issuerLabel = [mitm.issuerOrg, mitm.issuerCN].filter(Boolean).join(' / ')

  return (
    <div className={s.section}>
      {/* 섹션 헤더 */}
      <div className={s.sectionRow}>
        <span className={s.sectionLabel}>
          SSL Inspection
          <Tip
            align="left"
            text={"SSL Inspection은 기업 방화벽이 HTTPS(암호화된 통신)를 열어보는 기술입니다.\n\n방화벽이 서버 인증서를 받아 내용을 확인한 뒤, 자체 인증서를 새로 발급해 클라이언트에 전달합니다. 단말에 기업 CA가 미리 설치돼 있어 경고는 뜨지 않지만, 내용은 복호화됩니다.\n\n→ 이 서비스는 인증서 발급 기관을 보고 방화벽 개입 여부를 판단합니다."}
          />
        </span>
        <span className={`${s.verdict} ${s[meta.cls]}`}>
          {meta.icon} {meta.label}
        </span>
      </div>

      {/* 요약 */}
      <div className={s.summary}>{meta.summary}</div>

      {/* Issuer 정보 */}
      <div className={s.infoGrid}>
        {issuerLabel && (
          <div className={s.infoRow}>
            <span className={s.infoKey}>
              Issuer
              <Tip text={"이 TLS 인증서를 발급한 기관(CA)입니다.\n\nLet's Encrypt, DigiCert 같은 공개 CA가 아니라면 기업 내부 CA가 발급한 것으로, 방화벽이 SSL Inspection을 하는 강력한 증거입니다."} />
            </span>
            <span className={s.infoVal}>{issuerLabel}</span>
          </div>
        )}
        {mitm.validityDays !== null && mitm.validityDays !== undefined && (
          <div className={s.infoRow}>
            <span className={s.infoKey}>
              유효기간
              <Tip text={"인증서가 유효한 남은 날짜입니다.\n\n공개 CA의 인증서는 보통 수개월~1년 단위입니다. 방화벽이 즉석 발급한 인증서는 수일~수십일인 경우가 있습니다."} />
            </span>
            <span
              className={s.infoVal}
              style={mitm.validityDays < 30 ? { color: 'var(--c-warn, #d29922)' } : undefined}
            >
              {mitm.validityDays}일 남음
            </span>
          </div>
        )}
      </div>

      {/* 증거 드릴다운 */}
      {mitm.evidence.length > 0 && (
        <div className={s.evidenceSection}>
          <div className={s.evidenceSectionLabel}>
            판정 근거
            <Tip text={"클릭하면 각 증거의 의미와 판단 이유를 볼 수 있습니다."} align="right" />
          </div>
          {mitm.evidence.map((e, i) => (
            <EvidenceItem key={i} type={e.type} detail={e.detail} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 패널 ───────────────────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '100%', height: 32 }} />
      <div className={styles.skeletonLine} style={{ width: '70%' }} />
      <div className={styles.skeletonLine} style={{ width: '80%' }} />
    </div>
  )
}

export default function SecurityPanel({ mitm, blockDiagnosis, status }: Props) {
  const panelClass =
    status === 'loading' ? styles.loading
    : status === 'done'  ? styles.done
    : status === 'error' ? styles.error
    : ''

  const isBlocked = blockDiagnosis && blockDiagnosis.blockType !== 'PASS' && blockDiagnosis.blockType !== 'UNKNOWN'
  const isIntercepted = mitm?.verdict === 'INTERCEPTED'
  const isSuspicious = mitm?.verdict === 'SUSPICIOUS'

  const badgeText = isBlocked ? BLOCK_VERDICT_META[blockDiagnosis.blockType as BlockType]?.label
    : mitm?.verdict === 'INTERCEPTED' ? 'SSL Inspection'
    : mitm?.verdict === 'SUSPICIOUS' ? '인증서 의심'
    : mitm?.verdict === 'CLEAN' ? 'CLEAN'
    : ''

  const badgeColor =
    isBlocked || isIntercepted ? 'var(--c-danger)'
    : isSuspicious ? 'var(--c-warn, #d29922)'
    : mitm?.verdict === 'CLEAN' ? 'var(--c-green)'
    : 'var(--c-text-dim)'

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>보안 진단</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {status === 'done' && badgeText && (
          <span className={styles.badge} style={{ color: badgeColor }}>{badgeText}</span>
        )}
        {status === 'error' && <span className={styles.badge}>오류</span>}
      </div>

      {status === 'loading' && <SkeletonBody />}
      {status === 'error' && <div className={styles.dim}>보안 진단 실패</div>}

      {status === 'done' && (
        <div className={s.body}>
          {blockDiagnosis && <BlockSection block={blockDiagnosis} />}
          {mitm && <MitmSection mitm={mitm} />}
          {!mitm && !blockDiagnosis && (
            <div className={styles.dim}>진단 데이터 없음</div>
          )}
        </div>
      )}
    </div>
  )
}
