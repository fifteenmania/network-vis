import { useTranslation } from 'react-i18next'
import styles from './LanguageToggle.module.css'

export default function LanguageToggle() {
  const { i18n } = useTranslation()
  const current = i18n.language

  return (
    <div className={styles.toggle}>
      <button
        className={current === 'ko' ? styles.active : ''}
        onClick={() => i18n.changeLanguage('ko')}
      >
        KO
      </button>
      <span className={styles.sep}>|</span>
      <button
        className={current === 'en' ? styles.active : ''}
        onClick={() => i18n.changeLanguage('en')}
      >
        EN
      </button>
    </div>
  )
}
