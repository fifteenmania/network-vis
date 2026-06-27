import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DnsResult, DnsChainStep, SectionStatus } from '../../types/network'
import { useTraceStore } from '../../store/traceStore'
import CopyButton from '../common/CopyButton'
import { getCmdForDns, getCmdForDnsStep } from '../../utils/cmdCommands'
import styles from './PanelShell.module.css'
import chainStyles from './DnsChainPanel.module.css'

const TYPE_COLOR: Record<string, string> = {
  A:     'var(--c-text)',
  AAAA:  'var(--c-text)',
  CNAME: 'var(--c-text-2)',
}

const RESPONSE_LABEL: Record<string, string> = {
  referral: 'REFERRAL',
  answer:   'ANSWER',
  cached:   'CACHED',
}

interface DnsPanelProps {
  dns?: DnsResult | null
  status: SectionStatus
}

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '60%' }} />
      <div className={styles.skeletonLine} style={{ width: '90%' }} />
      <div className={styles.skeletonLine} style={{ width: '75%' }} />
    </div>
  )
}

function DnsChainView({ chain }: { chain: DnsChainStep[] }) {
  return (
    <div className={chainStyles.chain}>
      {chain.map((step, i) => {
        const isLast = i === chain.length - 1
        const responseClass =
          step.responseType === 'answer' ? chainStyles.answer
          : step.responseType === 'cached' ? chainStyles.cached
          : ''
        return (
          <div key={i} className={chainStyles.step}>
            <div className={chainStyles.node}>
              <span className={chainStyles.nodeType}>{step.serverType.toUpperCase()}</span>
              <span className={chainStyles.nodeLabel}>{step.serverLabel}</span>
              <span className={chainStyles.nodeIp}>{step.server}</span>
              <div className={chainStyles.nodeCopyBtn}>
                <CopyButton command={getCmdForDnsStep(step.query, step.server)} />
              </div>
            </div>

            <div className={chainStyles.arrow}>
              <span className={chainStyles.query}>
                {step.queryType} {step.query}
              </span>
              <span className={`${chainStyles.response} ${responseClass}`}>
                {RESPONSE_LABEL[step.responseType]}
                {step.durationMs > 0 && ` +${step.durationMs}ms`}
              </span>
              {step.records.length > 0 && (
                <div className={chainStyles.records}>
                  {step.records.map((r, j) => (
                    <span key={j} className={chainStyles.record}>
                      {r.type} {r.value}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {!isLast && <div className={chainStyles.connector} />}
          </div>
        )
      })}
    </div>
  )
}

export default function DnsPanel({ dns, status }: DnsPanelProps) {
  const { t } = useTranslation()
  const { target } = useTraceStore()
  const [chainOpen, setChainOpen] = useState(false)

  const panelClass = status === 'loading' ? styles.loading
    : status === 'done' ? styles.done
    : status === 'error' ? styles.error
    : ''

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels.dns.title')}</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {status === 'done' && dns && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.badge}>{dns.durationMs}ms</span>
            {target && <CopyButton command={getCmdForDns(target)} />}
          </div>
        )}
        {status === 'error' && <span className={styles.badge}>{t('common.error')}</span>}
      </div>

      {status === 'loading' && <SkeletonBody />}

      {status === 'error' && (
        <div className={styles.dim}>{t('panels.dns.error')}</div>
      )}

      {status === 'done' && dns && (
        <>
          <div className={styles.dim} style={{ marginBottom: 8 }}>
            {t('panels.dns.resolver')}: <span className={styles.mono}>{dns.resolver}</span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('panels.dns.type')}</th>
                <th>{t('panels.dns.value')}</th>
                <th>{t('panels.dns.ttl')}</th>
              </tr>
            </thead>
            <tbody>
              {dns.records.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span style={{ color: TYPE_COLOR[r.type] ?? 'var(--c-text-2)' }}>{r.type}</span>
                  </td>
                  <td style={{ color: 'var(--c-text)' }}>{r.value}</td>
                  <td className={styles.dim}>{r.ttl}s</td>
                </tr>
              ))}
            </tbody>
          </table>

          {dns.chain.length > 0 && (
            <>
              <button
                className={chainStyles.toggleBtn}
                onClick={() => setChainOpen(o => !o)}
                aria-expanded={chainOpen}
              >
                <span className={`${chainStyles.chevron} ${chainOpen ? chainStyles.open : ''}`}>▶</span>
                {t('panels.dns.chainToggle')}
              </button>
              {chainOpen && <DnsChainView chain={dns.chain} />}
            </>
          )}
        </>
      )}
    </div>
  )
}
