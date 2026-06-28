import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TraceHop, SectionStatus } from '../../types/network'
import { useTraceStore } from '../../store/traceStore'
import CopyButton from '../common/CopyButton'
import { getCmdForTracert } from '../../utils/cmdCommands'
import styles from './PanelShell.module.css'
import traceStyles from './TracePanel.module.css'

interface TracePanelProps {
  hops?: TraceHop[] | null
  visibleCount: number
  status: SectionStatus
}

function rttColor(rtt: number) {
  if (rtt < 10) return 'var(--c-green)'
  if (rtt < 50) return 'var(--c-text)'
  return 'var(--c-danger)'
}

const AS_COLORS = [
  'var(--c-accent)',
  'var(--c-text-2)',
  'var(--c-green)',
  'var(--c-text)',
]

function asColor(asn: number) {
  return AS_COLORS[asn % AS_COLORS.length]
}

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      {[80, 65, 90, 75].map((w, i) => (
        <div key={i} className={styles.skeletonLine} style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

export default function TracePanel({ hops, visibleCount, status }: TracePanelProps) {
  const { t } = useTranslation()
  const { selectedHop, selectHop, target } = useTraceStore()
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])

  useEffect(() => {
    if (selectedHop !== null && rowRefs.current[selectedHop]) {
      rowRefs.current[selectedHop]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [selectedHop])

  const panelClass = status === 'loading' ? styles.loading
    : status === 'done' ? styles.done
    : status === 'error' ? styles.error
    : ''

  const visibleHops = hops?.slice(0, visibleCount) ?? []
  const hasData = (hops?.length ?? 0) > 0

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels.trace.title')}</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {(status === 'loading' || status === 'done') && hops && hops.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.badge}>{visibleCount}{status === 'done' ? `/${hops.length}` : ''} hops</span>
            {status === 'done' && target && <CopyButton command={getCmdForTracert(target)} />}
          </div>
        )}
        {status === 'error' && <span className={styles.badge}>{t('common.error')}</span>}
      </div>

      {status === 'loading' && !hasData && <SkeletonBody />}
      {status === 'error' && <div className={styles.dim}>{t('panels.trace.error')}</div>}

      {(status === 'loading' || status === 'done') && hasData && (
        <>
          <div className={traceStyles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>IP</th>
                  <th>AS</th>
                  <th>{t('panels.trace.location')}</th>
                  <th>{t('panels.trace.rtt')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleHops.map((hop, i) => {
                  const hasRtt = hop.rttMs.length > 0
                  const avgRtt = hasRtt
                    ? hop.rttMs.reduce((a, b) => a + b, 0) / hop.rttMs.length
                    : null
                  const isSelected = selectedHop === i
                  const color = hop.as ? asColor(hop.as.asn) : 'var(--c-text-dim)'
                  const isUnknownLoc = hop.location.lat === 0 && hop.location.lng === 0

                  return (
                    <tr
                      key={hop.hop}
                      ref={(el) => { rowRefs.current[i] = el }}
                      className={isSelected ? traceStyles.selected : ''}
                      onClick={() => selectHop(isSelected ? null : i)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className={styles.dim}>{hop.hop}</td>
                      <td style={{ color: 'var(--c-text)' }}>
                        {hop.ip}
                        {hop.hostname && (
                          <div className={styles.dim}>{hop.hostname}</div>
                        )}
                      </td>
                      <td>
                        {hop.as ? (
                          <span
                            title={`AS${hop.as.asn} ${hop.as.org} (${hop.as.prefix})`}
                            style={{ color, fontSize: 'var(--fs-2xs)', fontFamily: 'var(--font-mono)', cursor: 'help' }}
                          >
                            AS{hop.as.asn}
                            <div style={{ color: 'var(--c-text-dim)', fontSize: 'var(--fs-2xs)' }}>{hop.as.org}</div>
                          </span>
                        ) : (
                          <span className={styles.dim}>—</span>
                        )}
                      </td>
                      <td className={styles.dim} style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {hop.internal ? t('panels.trace.internal') : (isUnknownLoc ? '—' : hop.location.label)}
                        {hop.anycast && !isUnknownLoc && (
                          <span className={traceStyles.anycastBadge}>
                            {t('panels.trace.anycast')}
                          </span>
                        )}
                      </td>
                      <td style={{ color: avgRtt !== null ? rttColor(avgRtt) : 'var(--c-text-dim)' }}>
                        {avgRtt !== null ? `${avgRtt.toFixed(1)}ms` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {selectedHop !== null && hops && hops[selectedHop]?.as && (
            <div className={traceStyles.hopDetail}>
              <div className={styles.dim} style={{ marginBottom: 4 }}>{t('panels.trace.bgpInfo')}</div>
              {[
                [t('panels.trace.asNumber'), `AS${hops[selectedHop].as!.asn}`],
                [t('panels.trace.org'),      hops[selectedHop].as!.org],
                [t('panels.trace.country'),  hops[selectedHop].as!.country],
                [t('panels.trace.prefix'),   hops[selectedHop].as!.prefix],
              ].map(([label, value]) => (
                <div key={label} className={traceStyles.detailRow}>
                  <span className={styles.dim}>{label}</span>
                  <span style={{ color: 'var(--c-text)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
