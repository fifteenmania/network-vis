/**
 * useTracePlayback
 *
 * SSE 스트리밍으로 hop이 도착하는 즉시 appendHop()이 visibleHops를 올리므로
 * 별도의 stagger 타이머가 필요 없습니다.
 *
 * TLS step 애니메이션은 TlsPanel 내부에서 로컬 useEffect로 관리합니다.
 */
export function useTracePlayback() {}
