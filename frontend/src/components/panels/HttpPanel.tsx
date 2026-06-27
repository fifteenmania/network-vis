import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HttpResult, HttpHeader, SectionStatus } from '../../types/network'
import { useTraceStore } from '../../store/traceStore'
import CopyButton from '../common/CopyButton'
import { getCmdForHttp } from '../../utils/cmdCommands'
import styles from './PanelShell.module.css'
import httpStyles from './HttpPanel.module.css'

interface HttpPanelProps {
  http?: HttpResult | null
  status: SectionStatus
}

function HeaderTable({ headers, label }: { headers: HttpHeader[]; label: string }) {
  const pseudos = headers.filter((h) => h.pseudo)
  const regular = headers.filter((h) => !h.pseudo)

  return (
    <div className={httpStyles.headerSection}>
      <div className={httpStyles.headerLabel}>{label}</div>
      <table className={styles.table}>
        <tbody>
          {pseudos.map((h) => (
            <tr key={h.name}>
              <td style={{ color: 'var(--c-text)', width: '40%' }}>{h.name}</td>
              <td style={{ color: 'var(--c-text-2)' }}>{h.value}</td>
            </tr>
          ))}
          {regular.map((h) => (
            <tr key={h.name}>
              <td style={{ color: 'var(--c-text-2)', width: '40%' }}>{h.name}</td>
              <td style={{ color: 'var(--c-text-2)', wordBreak: 'break-all' }}>{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '55%' }} />
      <div className={styles.skeletonLine} style={{ width: '80%' }} />
      <div className={styles.skeletonLine} style={{ width: '70%' }} />
    </div>
  )
}

export default function HttpPanel({ http, status }: HttpPanelProps) {
  const { t } = useTranslation()
  const { target } = useTraceStore()
  const [tab, setTab] = useState<'summary' | 'request' | 'response'>('summary')

  const panelClass = status === 'loading' ? styles.loading
    : status === 'done' ? styles.done
    : status === 'error' ? styles.error
    : ''

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels.http.title')}</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {status === 'done' && http && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.badge}>{http.protocol} · {http.durationMs}ms</span>
            {target && <CopyButton command={getCmdForHttp(target)} />}
          </div>
        )}
        {status === 'error' && <span className={styles.badge}>{t('common.error')}</span>}
      </div>

      {status === 'loading' && <SkeletonBody />}
      {status === 'error' && <div className={styles.dim}>{t('panels.http.error')}</div>}

      {status === 'done' && http && (
        <>
          <div className={httpStyles.tabs}>
            {(['summary', 'request', 'response'] as const).map((tabKey) => (
              <button
                key={tabKey}
                className={`${httpStyles.tab} ${tab === tabKey ? httpStyles.activeTab : ''}`}
                onClick={() => setTab(tabKey)}
              >
                {tabKey === 'summary'
                  ? t('panels.http.summary')
                  : tabKey === 'request'
                  ? t('panels.http.reqHeaders')
                  : t('panels.http.resHeaders')}
              </button>
            ))}
          </div>

          {tab === 'summary' && (
            <div className={httpStyles.summary}>
              {[
                [t('panels.http.method'),   <span className={httpStyles.method}>GET</span>],
                [t('panels.http.status'),   <span style={{ color: http.status >= 200 && http.status < 300 ? 'var(--c-green)' : 'var(--c-danger)', fontWeight: 600 }}>{http.status} {http.statusText}</span>],
                [t('panels.http.protocol'), <span className={styles.mono}>{http.protocol}</span>],
                [t('panels.http.duration'), <span className={styles.mono}>{http.durationMs}ms</span>],
                [t('panels.http.bodySize'), <span className={styles.mono}>{http.bodySize ? `${(http.bodySize / 1024).toFixed(1)} KB` : '—'}</span>],
              ].map(([label, value], i) => (
                <div key={i} className={httpStyles.row}>
                  <span className={styles.dim}>{label as string}</span>
                  {value as React.ReactNode}
                </div>
              ))}
            </div>
          )}

          {tab === 'request' && (
            <HeaderTable
              headers={http.requestHeaders}
              label={`${http.requestHeaders.length} headers`}
            />
          )}

          {tab === 'response' && (
            <HeaderTable
              headers={http.responseHeaders}
              label={`${http.responseHeaders.length} headers`}
            />
          )}
        </>
      )}
    </div>
  )
}
