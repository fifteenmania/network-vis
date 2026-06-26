import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { TlsResult, SectionStatus } from '../../types/network'
import CertChainPanel from './CertChainPanel'
import styles from './PanelShell.module.css'
import tlsStyles from './TlsPanel.module.css'

const CLIENT_STEPS = new Set(['TCP Connect', 'ClientHello', 'Finished'])

interface TlsPanelProps {
  tls?: TlsResult | null
  status: SectionStatus
}

function SkeletonBody() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '65%' }} />
      <div className={styles.skeletonLine} style={{ width: '80%' }} />
      <div className={styles.skeletonLine} style={{ width: '55%' }} />
    </div>
  )
}

export default function TlsPanel({ tls, status }: TlsPanelProps) {
  const { t } = useTranslation()
  const [visibleSteps, setVisibleSteps] = useState(0)

  useEffect(() => {
    if (status !== 'done' || !tls) return
    setVisibleSteps(0)
    let count = 0
    const id = setInterval(() => {
      count += 1
      setVisibleSteps(count)
      if (count >= tls.steps.length) clearInterval(id)
    }, 500)
    return () => clearInterval(id)
  }, [status, tls])

  const panelClass = status === 'loading' ? styles.loading
    : status === 'done' ? styles.done
    : status === 'error' ? styles.error
    : ''

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels.tls.title')}</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {status === 'done' && tls && (
          <span className={styles.badge}>
            {tls.negotiated.version} · {tls.negotiated.handshakeDurationMs}ms
          </span>
        )}
        {status === 'error' && <span className={styles.badge}>{t('common.error')}</span>}
      </div>

      {status === 'loading' && <SkeletonBody />}
      {status === 'error' && <div className={styles.dim}>{t('panels.tls.error')}</div>}

      {status === 'done' && tls && (
        <>
          <div className={tlsStyles.diagram}>
            <div className={tlsStyles.lane}>
              <div className={tlsStyles.laneLabel}>{t('panels.tls.direction.client')}</div>
            </div>
            <div className={tlsStyles.arrows}>
              {tls.steps.slice(0, visibleSteps).map((step, i) => {
                const isClient = CLIENT_STEPS.has(step.step)
                return (
                  <div key={i} className={`${tlsStyles.step} ${isClient ? tlsStyles.toRight : tlsStyles.toLeft}`}>
                    <span className={tlsStyles.label}>{step.step}</span>
                    <span className={tlsStyles.desc}>{step.description}</span>
                    {step.detail && (
                      <div className={tlsStyles.details}>
                        <span>{step.detail}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className={tlsStyles.lane}>
              <div className={tlsStyles.laneLabel}>{t('panels.tls.direction.server')}</div>
            </div>
          </div>

          {tls.certChain.length > 0 && visibleSteps >= tls.steps.length && (
            <CertChainPanel certChain={tls.certChain} />
          )}
        </>
      )}
    </div>
  )
}
