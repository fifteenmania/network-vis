import { useTranslation } from 'react-i18next'
import type { SectionStatus } from '../../types/network'
import { useTraceStore } from '../../store/traceStore'
import CopyButton from '../common/CopyButton'
import { getCmdForTcp } from '../../utils/cmdCommands'
import styles from './PanelShell.module.css'
import tcpStyles from './TcpPanel.module.css'

interface TcpPanelProps {
  status: SectionStatus
}

const STEPS = ['synSent', 'synAckReceived', 'ackSent', 'established'] as const

export default function TcpPanel({ status }: TcpPanelProps) {
  const { t } = useTranslation()
  const { target } = useTraceStore()
  const panelClass = status === 'loading' ? styles.loading
    : status === 'done' ? styles.done
    : status === 'error' ? styles.error
    : ''

  return (
    <div className={`${styles.panel} ${panelClass}`}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels.tcp.title')}</span>
        {status === 'loading' && <span className={styles.spinner} />}
        {status === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className={styles.badge}>3-Way Handshake</span>
            {target && <CopyButton command={getCmdForTcp(target)} />}
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className={styles.skeleton}>
          <div className={styles.skeletonLine} style={{ width: '70%' }} />
          <div className={styles.skeletonLine} style={{ width: '55%' }} />
        </div>
      )}

      {(status === 'done' || status === 'error') && (
        <div className={tcpStyles.steps}>
          {STEPS.map((step) => (
            <div key={step} className={tcpStyles.step}>
              <span className={tcpStyles.dot} />
              <span>{t(`panels.tcp.${step}`)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
