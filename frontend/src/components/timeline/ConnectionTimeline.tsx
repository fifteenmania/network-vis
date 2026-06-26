import { useTranslation } from 'react-i18next'
import { useTraceStore } from '../../store/traceStore'
import type { SectionStatus } from '../../types/network'
import styles from './ConnectionTimeline.module.css'
import tStyles from './ConnectionTimeline.module.css'

interface Chip {
  key: string
  label: string
  status: SectionStatus
}

function StatusIcon({ status }: { status: SectionStatus }) {
  if (status === 'loading') return <span className={tStyles.chipSpinner} aria-hidden />
  if (status === 'done')    return <span aria-hidden>✓</span>
  if (status === 'error')   return <span aria-hidden>✕</span>
  return <span aria-hidden>·</span>
}

function Chip({ chip }: { chip: Chip }) {
  const cls = chip.status === 'done'    ? tStyles.chipDone
    : chip.status === 'loading' ? tStyles.chipLoading
    : chip.status === 'error'   ? tStyles.chipError
    : tStyles.chipIdle

  return (
    <div className={`${tStyles.chip} ${cls}`}>
      <StatusIcon status={chip.status} />
      <span className={tStyles.chipLabel}>{chip.label}</span>
    </div>
  )
}

export default function ConnectionTimeline() {
  const { t } = useTranslation()
  const {
    target,
    dnsStatus, hopsStatus, tlsStatus, httpStatus,
    reset,
  } = useTraceStore()

  const isAllIdle =
    dnsStatus === 'idle' &&
    hopsStatus === 'idle' &&
    tlsStatus === 'idle' &&
    httpStatus === 'idle'

  if (isAllIdle) return null

  const chips: Chip[] = [
    { key: 'dns',   label: t('phases.dns'),   status: dnsStatus },
    { key: 'trace', label: t('phases.trace'), status: hopsStatus },
    { key: 'tcp',   label: t('phases.tcp'),   status: tlsStatus === 'idle' ? 'idle' : tlsStatus === 'loading' ? 'loading' : 'done' },
    { key: 'tls',   label: t('phases.tls'),   status: tlsStatus },
    { key: 'http',  label: t('phases.http'),  status: httpStatus },
  ]

  return (
    <div className={styles.timeline}>
      <div className={styles.controls}>
        <button className={styles.ctrl} onClick={reset} title={t('timeline.reset')}>
          ↺
        </button>
        {target && (
          <span className={styles.total}>
            <strong>{target}</strong>
          </span>
        )}
      </div>

      <div className={styles.steps}>
        {chips.map((chip, i) => (
          <div key={chip.key} style={{ display: 'flex', alignItems: 'center' }}>
            <Chip chip={chip} />
            {i < chips.length - 1 && <span className={styles.connector} aria-hidden />}
          </div>
        ))}
      </div>
    </div>
  )
}
