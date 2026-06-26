import { useState } from 'react'
import type { CertInfo } from '../../types/network'
import styles from './PanelShell.module.css'
import certStyles from './CertChainPanel.module.css'

interface CertChainPanelProps {
  certChain: CertInfo[]
}

export default function CertChainPanel({ certChain }: CertChainPanelProps) {
  const [expanded, setExpanded] = useState<number | null>(certChain.length - 1)

  return (
    <div className={certStyles.section}>
      <div className={styles.dim} style={{ marginBottom: 6 }}>
        Certificate Chain
      </div>
      <div className={certStyles.chain}>
        {certChain.map((cert, i) => {
          const isLeaf = i === certChain.length - 1
          const isRoot = cert.isRoot
          const label = isRoot ? 'ROOT' : isLeaf ? 'LEAF' : 'INTER'
          const isOpen = expanded === i

          return (
            <div key={i} className={certStyles.cert}>
              <button
                className={certStyles.certHeader}
                onClick={() => setExpanded(isOpen ? null : i)}
              >
                <span className={certStyles.certBadge}>{label}</span>
                <span className={certStyles.certSubject}>{cert.subject.replace('CN=', '')}</span>
                {cert.isTrusted && <span className={certStyles.trusted}>✓</span>}
                <span className={certStyles.chevron} style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}>▶</span>
              </button>

              {isOpen && (
                <div className={certStyles.certBody}>
                  <CertRow label="Subject"   value={cert.subject} />
                  <CertRow label="Issuer"    value={cert.issuer} />
                  <CertRow label="Serial"    value={cert.serialNumber} mono />
                  <CertRow label="Valid From" value={cert.validFrom} />
                  <CertRow label="Valid Until" value={cert.validUntil} />
                  <CertRow label="Key"       value={cert.keyType} />
                  <CertRow label="Signature" value={cert.signatureAlgorithm} />
                  {cert.san && cert.san.length > 0 && (
                    <CertRow label="SAN" value={cert.san.join(', ')} />
                  )}
                  {cert.ocspUrl && (
                    <CertRow label="OCSP" value={cert.ocspUrl} />
                  )}
                </div>
              )}
              {i < certChain.length - 1 && (
                <div className={certStyles.chainArrow}>signed by</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CertRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '2px 0',
      borderBottom: '1px solid var(--c-border-2)',
      fontSize: 'var(--fs-2xs)',
    }}>
      <span style={{
        color: 'var(--c-text-dim)',
        minWidth: 72,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
      }}>
        {label}
      </span>
      <span style={{
        color: 'var(--c-text-2)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}
