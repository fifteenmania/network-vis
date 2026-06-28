import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTraceStore } from '../../store/traceStore'
import type { TraceHop } from '../../types/network'
import styles from './SearchBar.module.css'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api'

/**
 * SSE 스트림을 읽어 hop을 store에 순차적으로 주입합니다.
 * AbortController signal로 취소 가능합니다.
 */
async function streamTraceroute(host: string, signal: AbortSignal): Promise<void> {
  const store = useTraceStore.getState()

  let response: Response
  try {
    response = await fetch(
      `${API_BASE}/traceroute?host=${encodeURIComponent(host)}`,
      { signal },
    )
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    throw err
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (signal.aborted) return

      buf += decoder.decode(value, { stream: true })

      // SSE는 빈 줄(\n\n)로 이벤트를 구분
      const events = buf.split('\n\n')
      buf = events.pop()!   // 마지막 미완성 이벤트 버퍼에 유지

      for (const event of events) {
        const lines = event.split('\n')
        let eventType = 'message'
        let dataLine = ''

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim()
          if (line.startsWith('data:'))  dataLine  = line.slice(5).trim()
        }

        if (eventType === 'done') return

        if (eventType === 'error') {
          throw new Error(dataLine || 'traceroute error')
        }

        if (dataLine && eventType === 'message') {
          try {
            const hop = JSON.parse(dataLine) as TraceHop
            if (!signal.aborted) {
              store.appendHop(hop)
            }
          } catch {
            // 파싱 실패 줄은 무시
          }
        }
      }
    }
  } finally {
    reader.cancel()
  }
}


export default function SearchBar() {
  const { t } = useTranslation()
  const [value, setValue] = useState('api.openai.com')
  const [error, setError] = useState<string | null>(null)

  const { dnsStatus, hopsStatus, tlsStatus, httpStatus, beginTrace, reset } = useTraceStore()

  const isLoading =
    dnsStatus === 'loading' ||
    hopsStatus === 'loading' ||
    tlsStatus === 'loading' ||
    httpStatus === 'loading'

  const abortRef     = useRef<AbortController | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  const showError = useCallback((msg: string) => {
    setError(msg)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => {
      setError(null)
      errorTimerRef.current = null
    }, 5000)
  }, [])

  const handleTrace = useCallback(() => {
    const host = value.trim()
    if (!host) return

    // 이전 요청 취소
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    // 스토어 초기화 — 4개 섹션 loading 상태로
    beginTrace(host)
    setError(null)

    const opts: RequestInit = { signal: ctrl.signal }

    const handleFetchError = (section: 'dns' | 'hops' | 'tls' | 'http', err: unknown) => {
      if ((err as Error).name === 'AbortError') return
      // TypeError = fetch 자체 실패(백엔드 미실행/네트워크). 가짜 데이터로 가리지 않고 명확히 알림.
      if (err instanceof TypeError) {
        showError(t('search.backendError'))
      }
      useTraceStore.getState().setSectionError(section)
    }

    // DNS — geo 포함
    fetch(`${API_BASE}/dns?host=${encodeURIComponent(host)}`, opts)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(({ dns, client, destination }) => {
        if (!ctrl.signal.aborted)
          useTraceStore.getState().setDns(dns, { client, destination })
      })
      .catch((err) => handleFetchError('dns', err))

    // Traceroute — SSE 스트리밍
    streamTraceroute(host, ctrl.signal)
      .then(() => {
        if (!ctrl.signal.aborted)
          useTraceStore.getState().setHopsStatus('done')
      })
      .catch((err) => handleFetchError('hops', err))

    // TLS
    fetch(`${API_BASE}/tls?host=${encodeURIComponent(host)}`, opts)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((tls) => { if (!ctrl.signal.aborted) useTraceStore.getState().setTls(tls) })
      .catch((err) => handleFetchError('tls', err))

    // HTTP
    fetch(`${API_BASE}/http?host=${encodeURIComponent(host)}`, opts)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((http) => { if (!ctrl.signal.aborted) useTraceStore.getState().setHttp(http) })
      .catch((err) => handleFetchError('http', err))
  }, [value, beginTrace, showError, t])

  const handleCancel = useCallback(() => {
    abortRef.current?.abort()
    reset()
    setError(null)
  }, [reset])

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => { if (e.key === 'Enter') handleTrace() },
    [handleTrace],
  )

  return (
    <div className={styles.wrapper}>
      <div className={styles.bar}>
        <span className={styles.prompt}>$</span>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          spellCheck={false}
          autoComplete="off"
        />
        {isLoading ? (
          <button
            className={`${styles.button} ${styles.cancelButton}`}
            onClick={handleCancel}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
        ) : (
          <button
            className={styles.button}
            onClick={handleTrace}
            disabled={!value.trim()}
            aria-label={t('search.button')}
          >
            {t('search.button')}
          </button>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}
