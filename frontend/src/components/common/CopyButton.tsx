import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './CopyButton.module.css'

interface CopyButtonProps {
  command: string
}

export default function CopyButton({ command }: CopyButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const el = document.createElement('textarea')
      el.value = command
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      className={`${styles.btn} ${copied ? styles.copied : ''}`}
      onClick={handleCopy}
      title={copied ? t('common.copied') : `${t('common.copyCmdTooltip')}: ${command}`}
      aria-label={t('common.copyCmdTooltip')}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="4" y="1" width="7" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1 4h2v6.5A.5.5 0 003.5 11H9v1H3a1 1 0 01-1-1V4z" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}
