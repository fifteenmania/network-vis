import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GlobeScene from '../globe/GlobeScene'
import StackPanel from '../panels/StackPanel'
import ConnectionTimeline from '../timeline/ConnectionTimeline'
import SearchBar from './SearchBar'
import LanguageToggle from './LanguageToggle'
import styles from './AppLayout.module.css'

const MIN_PANEL_WIDTH = 180
const MAX_PANEL_RATIO = 0.6

export default function AppLayout() {
  const { t } = useTranslation()
  const [panelWidth, setPanelWidth] = useState(300)
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }, [panelWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX.current - e.clientX
      const maxWidth = window.innerWidth * MAX_PANEL_RATIO
      const newWidth = Math.min(Math.max(startWidth.current + delta, MIN_PANEL_WIDTH), maxWidth)
      setPanelWidth(newWidth)
    }

    const onMouseUp = () => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>{t('appTitle')}</span>
        <SearchBar />
        <LanguageToggle />
      </header>

      <div className={styles.main}>
        <div className={styles.globe}>
          <GlobeScene />
        </div>
        <div
          className={styles.resizer}
          onMouseDown={onMouseDown}
        />
        <div style={{ width: panelWidth, flexShrink: 0, height: '100%' }}>
          <StackPanel />
        </div>
      </div>

      <ConnectionTimeline />
    </div>
  )
}
