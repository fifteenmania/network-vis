import { create } from 'zustand'
import type {
  SectionStatus, SectionKey,
  DnsResult, TraceHop, TlsResult, HttpResult, GeoPoint,
} from '../types/network'

interface TraceState {
  target: string | null
  client: GeoPoint | null
  destination: GeoPoint | null

  dns: DnsResult | null
  dnsStatus: SectionStatus

  hops: TraceHop[] | null
  hopsStatus: SectionStatus

  tls: TlsResult | null
  tlsStatus: SectionStatus

  http: HttpResult | null
  httpStatus: SectionStatus

  visibleHops: number
  selectedHop: number | null

  // 조회 시작 — 모든 섹션을 loading으로 초기화
  beginTrace: (target: string) => void

  // 섹션별 완료 액션
  setDns: (data: DnsResult, geo: { client: GeoPoint; destination: GeoPoint }) => void
  setHops: (data: TraceHop[]) => void
  appendHop: (hop: TraceHop) => void
  setHopsStatus: (status: SectionStatus) => void
  setTls: (data: TlsResult) => void
  setHttp: (data: HttpResult) => void
  setSectionError: (section: SectionKey) => void

  // hop 애니메이션
  setVisibleHops: (n: number) => void
  incrementVisibleHops: () => void

  reset: () => void
  selectHop: (hop: number | null) => void
}

const IDLE_STATE = {
  target: null,
  client: null,
  destination: null,
  dns: null,      dnsStatus:  'idle' as SectionStatus,
  hops: null,     hopsStatus: 'idle' as SectionStatus,
  tls: null,      tlsStatus:  'idle' as SectionStatus,
  http: null,     httpStatus: 'idle' as SectionStatus,
  visibleHops: 0,
  selectedHop: null,
}

export const useTraceStore = create<TraceState>((set) => ({
  ...IDLE_STATE,

  beginTrace: (target) => set({
    ...IDLE_STATE,
    target,
    dnsStatus:  'loading',
    hopsStatus: 'loading',
    tlsStatus:  'loading',
    httpStatus: 'loading',
  }),

  setDns: (data, { client, destination }) =>
    set({ dns: data, dnsStatus: 'done', client, destination }),

  setHops: (data) =>
    set({ hops: data, hopsStatus: 'done', visibleHops: data.length }),

  // SSE 스트리밍: hop 하나씩 append. visibleHops도 즉시 증가시켜 stagger 불필요.
  appendHop: (hop) =>
    set((state) => ({
      hops: [...(state.hops ?? []), hop],
      visibleHops: (state.hops?.length ?? 0) + 1,
    })),

  setHopsStatus: (status) => set({ hopsStatus: status }),

  setTls: (data) =>
    set({ tls: data, tlsStatus: 'done' }),

  setHttp: (data) =>
    set({ http: data, httpStatus: 'done' }),

  setSectionError: (section) => {
    if (section === 'dns')  set({ dnsStatus:  'error' })
    else if (section === 'hops') set({ hopsStatus: 'error' })
    else if (section === 'tls')  set({ tlsStatus:  'error' })
    else if (section === 'http') set({ httpStatus: 'error' })
  },

  setVisibleHops: (n) => set({ visibleHops: n }),

  incrementVisibleHops: () =>
    set((state) => ({ visibleHops: state.visibleHops + 1 })),

  reset: () => set(IDLE_STATE),

  selectHop: (hop) => set({ selectedHop: hop }),
}))
