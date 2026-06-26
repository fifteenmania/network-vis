import { useTranslation } from 'react-i18next'
import { useTraceStore } from '../../store/traceStore'
import { useTracePlayback } from '../../hooks/useTracePlayback'
import DnsPanel from './DnsPanel'
import TracePanel from './TracePanel'
import TcpPanel from './TcpPanel'
import TlsPanel from './TlsPanel'
import HttpPanel from './HttpPanel'
import SecurityPanel from './SecurityPanel'
import styles from './StackPanel.module.css'

export default function StackPanel() {
  const { t } = useTranslation()
  const {
    dnsStatus, dns,
    hopsStatus, hops, visibleHops,
    tlsStatus, tls,
    httpStatus, http,
  } = useTraceStore()

  useTracePlayback()

  const isAllIdle =
    dnsStatus === 'idle' &&
    hopsStatus === 'idle' &&
    tlsStatus === 'idle' &&
    httpStatus === 'idle'

  if (isAllIdle) {
    return (
      <div className={styles.panel}>
        <div className={styles.placeholder}>
          {t('panels.placeholder')}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <DnsPanel dns={dns} status={dnsStatus} />

      <TracePanel hops={hops} visibleCount={visibleHops} status={hopsStatus} />

      {tlsStatus !== 'idle' && (
        <TcpPanel status={tlsStatus === 'loading' ? 'loading' : 'done'} />
      )}

      <TlsPanel tls={tls} status={tlsStatus} />

      <HttpPanel http={http} status={httpStatus} />

      <SecurityPanel
        mitm={tls?.mitm}
        blockDiagnosis={tls?.blockDiagnosis}
        status={tlsStatus}
      />
    </div>
  )
}
