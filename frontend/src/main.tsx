import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { useTraceStore } from './store/traceStore'
import type { NetworkTrace } from './types/network'

if (import.meta.env.DEV) {
  ;(window as Window & { __injectMock?: (trace: NetworkTrace) => void }).__injectMock =
    (trace: NetworkTrace) => {
      const store = useTraceStore.getState()
      store.beginTrace(trace.target)
      store.setDns(trace.dns, { client: trace.client, destination: trace.destination })
      store.setHops(trace.hops)
      store.setTls(trace.tls)
      store.setHttp(trace.http)
    }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
