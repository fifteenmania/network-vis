import { Suspense, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import * as THREE from 'three'
import Earth from './Earth'
import Atmosphere from './Atmosphere'
import HopMarker from './HopMarker'
import RouteArc from './RouteArc'
import PacketParticle from './PacketParticle'
import SmartOrbitControls from './SmartOrbitControls'
import { useTraceStore } from '../../store/traceStore'
import { latLngToVector3, buildArcCurve } from '../../utils/geo'
import type { TraceHop } from '../../types/network'

// ---------------------------------------------------------------------------
// 헬퍼 함수
// ---------------------------------------------------------------------------

function avgRtt(hop: TraceHop): number | null {
  if (!hop.rttMs.length) return null
  return hop.rttMs.reduce((a, b) => a + b, 0) / hop.rttMs.length
}

function rttToSpeed(rttMs: number): number {
  return Math.max(0.12, 1 / (1 + rttMs / 60))
}

function rttToColor(deltaRttMs: number): string {
  if (deltaRttMs < 20)  return '#3fb950'
  if (deltaRttMs < 80)  return '#e3b341'
  if (deltaRttMs < 200) return '#f0883e'
  return '#f85149'
}

// ---------------------------------------------------------------------------
// GlobeContent
// ---------------------------------------------------------------------------

function GlobeContent() {
  const {
    client, destination,
    hops, hopsStatus, visibleHops,
    httpStatus, dnsStatus,
  } = useTraceStore()

  const showMarkers    = dnsStatus !== 'idle'
  const showHopMarkers = hopsStatus !== 'idle'
  const showArcs       = hopsStatus !== 'idle'  // 스트리밍 중 hop 도착마다 arc 하나씩 표시
  const showPackets    = httpStatus === 'done'

  // 3D 좌표 변환
  const clientPos = useMemo(
    () => (client ? latLngToVector3(client.lat, client.lng, 1.01) : null),
    [client],
  )
  const destPos = useMemo(
    () => (destination ? latLngToVector3(destination.lat, destination.lng, 1.01) : null),
    [destination],
  )
  const hopPositions = useMemo(
    () => hops?.map((h) => latLngToVector3(h.location.lat, h.location.lng, 1.01)) ?? [],
    [hops],
  )

  /**
   * 트레이스 완료 시 카메라 목표 위치 (순수 파생 계산 → useMemo).
   * SmartOrbitControls 가 이 값을 받아 카메라를 이동한다.
   *
   * mid  = normalize(clientPos + destPos)  → 경로 중간 방향
   * dist = clamp(1.5 + angle × 2.2, 2.2, 5.0)
   */
  const camTarget = useMemo<THREE.Vector3 | null>(() => {
    if (hopsStatus !== 'done' || !clientPos || !destPos) return null
    const mid  = clientPos.clone().add(destPos).normalize()
    const dist = Math.max(2.2, Math.min(5.0, 1.5 + clientPos.angleTo(destPos) * 2.2))
    return mid.multiplyScalar(dist)
  }, [hopsStatus, clientPos, destPos])

  // arc 곡선
  const arcCurves = useMemo<(THREE.QuadraticBezierCurve3 | null)[]>(() => {
    if (!clientPos || !destPos || !hops) return []
    const allPoints = [clientPos, ...hopPositions, destPos]
    return allPoints.slice(0, -1).map((from, i) => {
      const fromHop = i > 0 ? hops[i - 1] : null
      const toHop   = i < hops.length ? hops[i] : null
      const bad = (h: typeof fromHop) =>
        h !== null && h.location.lat === 0 && h.location.lng === 0
      if (bad(fromHop) || bad(toHop)) return null
      return buildArcCurve(from, allPoints[i + 1])
    })
  }, [clientPos, destPos, hopPositions, hops])

  // arc 색상: 증분 RTT
  const arcColors = useMemo(() => {
    if (!hops) return arcCurves.map(() => '#2f81f7')
    return arcCurves.map((curve, i) => {
      if (!curve) return '#2f81f7'
      const toRtt   = i < hops.length ? avgRtt(hops[i])     : null
      const fromRtt = i > 0           ? avgRtt(hops[i - 1]) : null
      if (toRtt === null) return '#2f81f7'
      return rttToColor(fromRtt !== null ? Math.max(0, toRtt - fromRtt) : toRtt)
    })
  }, [arcCurves, hops])

  // 표시할 hop 슬라이스
  const visibleHopsSlice = useMemo(
    () => (showHopMarkers ? hops?.slice(0, visibleHops) ?? [] : []),
    [showHopMarkers, hops, visibleHops],
  )
  const visiblePositions = useMemo(
    () => hopPositions.slice(0, visibleHopsSlice.length),
    [hopPositions, visibleHopsSlice.length],
  )

  const visibleArcCount = showArcs ? Math.min(visibleHops, arcCurves.length) : 0

  return (
    <>
      <SmartOrbitControls camTarget={camTarget} />

      <ambientLight intensity={1.6} />
      <directionalLight position={[5, 3, 5]} intensity={1.2} color="#fff8e7" />
      <pointLight position={[-6, -2, -6]} intensity={0.4} color="#4fc3f7" />

      <Stars radius={120} depth={60} count={6000} factor={4} fade />

      <Suspense fallback={null}>
        <Earth />
      </Suspense>
      <Atmosphere />

      {/* 클라이언트 마커 */}
      {showMarkers && clientPos && client && (
        <HopMarker position={clientPos} kind="client" hopIndex={-1} point={client} />
      )}

      {/* hop 마커 — 클러스터링 없음. lat:0 lng:0(unknown)은 skip. */}
      {visibleHopsSlice.map((hop, i) => {
        if (hop.location.lat === 0 && hop.location.lng === 0) return null
        return (
          <HopMarker
            key={`hop-${hop.hop}-${i}`}
            position={visiblePositions[i]}
            kind="router"
            hopIndex={i}
            point={hop.location}
            hop={hop}
          />
        )
      })}

      {/* 목적지 마커 */}
      {showArcs && destPos && destination && (
        <HopMarker
          position={destPos}
          kind="destination"
          hopIndex={hops?.length ?? 0}
          point={destination}
        />
      )}

      {/* RTT 색상 arc */}
      {arcCurves.slice(0, visibleArcCount).map((curve, i) => {
        if (!curve) return null
        return (
          <RouteArc
            key={i}
            curve={curve}
            color={arcColors[i] ?? '#2f81f7'}
            opacity={0.65}
          />
        )
      })}

      {/* 패킷 파티클 */}
      {showPackets && arcCurves.map((curve, i) => {
        if (!curve) return null
        const hop = hops?.[i]
        if (!hop || hop.ip === '*') return null
        const rtt = avgRtt(hop)
        if (rtt === null) return null
        return (
          <PacketParticle
            key={i}
            curve={curve}
            speed={rttToSpeed(rtt)}
            offset={i * 0.14}
          />
        )
      })}
    </>
  )
}

export default function GlobeScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 2.8], fov: 45 }}
      style={{ background: '#0d1117', width: '100%', height: '100%' }}
    >
      <GlobeContent />
    </Canvas>
  )
}
