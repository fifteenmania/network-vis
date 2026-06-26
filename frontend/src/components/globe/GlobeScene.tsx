import { Suspense, useMemo, useState, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import Earth from './Earth'
import Atmosphere from './Atmosphere'
import HopMarker from './HopMarker'
import RouteArc from './RouteArc'
import PacketParticle from './PacketParticle'
import { useTraceStore } from '../../store/traceStore'
import { latLngToVector3, buildArcCurve } from '../../utils/geo'
import type { TraceHop } from '../../types/network'

// ---------------------------------------------------------------------------
// 헬퍼 함수
// ---------------------------------------------------------------------------

/** hop.rttMs 배열의 평균. 빈 배열(timeout)이면 null. */
function avgRtt(hop: TraceHop): number | null {
  if (!hop.rttMs.length) return null
  return hop.rttMs.reduce((a, b) => a + b, 0) / hop.rttMs.length
}

/**
 * RTT → 파티클 이동 speed.
 *   30ms  → 0.80  (빠름)
 *   150ms → 0.40
 *   500ms → 0.18  (느림)
 */
function rttToSpeed(rttMs: number): number {
  return Math.max(0.12, 1 / (1 + rttMs / 60))
}

/**
 * 증분 RTT → arc 색상.
 * 구간에서 추가된 지연이 클수록 따뜻한 색(빨강).
 */
function rttToColor(deltaRttMs: number): string {
  if (deltaRttMs < 20)  return '#3fb950'  // 초록: 20ms 미만
  if (deltaRttMs < 80)  return '#e3b341'  // 노랑: 20~80ms
  if (deltaRttMs < 200) return '#f0883e'  // 주황: 80~200ms
  return '#f85149'                         // 빨강: 200ms 이상
}

// ---------------------------------------------------------------------------
// 카메라 거리 → 클러스터링 threshold (구면 각도, 라디안)
// ---------------------------------------------------------------------------

/**
 * 줌 레벨별 클러스터링 threshold (히스테리시스 적용).
 * threshold = 0 → 클러스터링 없음 (모든 hop 개별 표시).
 *
 * 경계에서 카메라 댐핑에 의한 진동으로 setState가 반복 호출되는 것을
 * 막기 위해 진입/이탈 경계를 분리합니다.
 */
function getClusterThreshold(cameraDistance: number, current: number): number {
  if (current === 0.00) {
    // 클러스터 없음 상태 → 2.5 이상이어야 중간으로 전환 (진입 2.2, 이탈 2.5)
    return cameraDistance > 2.5 ? 0.06 : 0.00
  }
  if (current === 0.06) {
    if (cameraDistance < 1.9) return 0.00   // 더 가까이 오면 해제
    if (cameraDistance > 3.5) return 0.12   // 더 멀어지면 강한 클러스터링
    return 0.06
  }
  // current === 0.12
  return cameraDistance < 3.0 ? 0.06 : 0.12  // 가까워지면 중간으로
}

// ---------------------------------------------------------------------------
// 클러스터 타입 및 빌더
// ---------------------------------------------------------------------------

interface HopCluster {
  hops: TraceHop[]
  centerPos: THREE.Vector3  // 클러스터의 대표 위치 (첫 번째 유효 hop)
  avgRttMs: number | null
  firstIndex: number        // 원본 hops 배열에서 첫 번째 hop의 인덱스
}

/**
 * 순차 클러스터링: 인접한 hop들이 threshold 미만의 구면 각도를 가지면 묶음.
 * (0,0) GeoIP 미조회 hop은 별도 클러스터로 분리.
 */
function buildClusters(
  hops: TraceHop[],
  positions: THREE.Vector3[],
  threshold: number,
): HopCluster[] {
  if (!hops.length) return []

  const clusters: HopCluster[] = []
  let groupHops: TraceHop[]       = [hops[0]]
  let groupPos: THREE.Vector3[]   = [positions[0]]
  let firstIndex                  = 0

  const isInvalidPos = (h: TraceHop) => h.location.lat === 0 && h.location.lng === 0

  for (let i = 1; i < hops.length; i++) {
    const canMerge =
      threshold > 0 &&
      !isInvalidPos(hops[i]) &&
      !isInvalidPos(hops[i - 1]) &&
      positions[i].angleTo(positions[i - 1]) < threshold

    if (canMerge) {
      groupHops.push(hops[i])
      groupPos.push(positions[i])
    } else {
      const rtts = groupHops
        .map(avgRtt)
        .filter((r): r is number => r !== null)
      clusters.push({
        hops: groupHops,
        centerPos: groupPos[0],
        avgRttMs: rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null,
        firstIndex,
      })
      groupHops  = [hops[i]]
      groupPos   = [positions[i]]
      firstIndex = i
    }
  }

  // 마지막 그룹 처리
  const rtts = groupHops.map(avgRtt).filter((r): r is number => r !== null)
  clusters.push({
    hops: groupHops,
    centerPos: groupPos[0],
    avgRttMs: rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null,
    firstIndex,
  })

  return clusters
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
  // hop 마커는 traceroute 시작 즉시 SSE 스트리밍 중에도 점진적으로 표시
  const showHopMarkers = hopsStatus !== 'idle'
  // arc 선은 모든 hop이 수신된 후에만 그림 (중간 상태에서 끊긴 선 방지)
  const showArcs       = hopsStatus === 'done'
  const showPackets    = httpStatus === 'done'

  // 카메라 거리에 따른 클러스터링 threshold
  const [clusterThreshold, setClusterThreshold] = useState(() => getClusterThreshold(2.8, 0.06))
  const prevThresholdRef = useRef(clusterThreshold)

  useFrame(({ camera }) => {
    const t = getClusterThreshold(camera.position.length(), prevThresholdRef.current)
    if (t !== prevThresholdRef.current) {
      prevThresholdRef.current = t
      setClusterThreshold(t)
    }
  })

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
   * allPoints = [client, hop0, hop1, ..., hopN, dest]
   * arcCurves[i] = allPoints[i] → allPoints[i+1] 사이의 곡선 (null 가능)
   *
   * GeoIP 미조회 사설 IP는 (lat=0, lng=0)을 가집니다. 해당 hop이 endpoint인
   * arc는 그리지 않습니다.
   */
  const arcCurves = useMemo<(THREE.QuadraticBezierCurve3 | null)[]>(() => {
    if (!clientPos || !destPos || !hops) return []
    const allPoints = [clientPos, ...hopPositions, destPos]
    return allPoints.slice(0, -1).map((from, i) => {
      const fromHop = i > 0 ? hops[i - 1] : null
      const toHop   = i < hops.length ? hops[i] : null
      const isInvalid = (h: typeof fromHop) =>
        h !== null && h.location.lat === 0 && h.location.lng === 0
      if (isInvalid(fromHop) || isInvalid(toHop)) return null
      return buildArcCurve(from, allPoints[i + 1])
    })
  }, [clientPos, destPos, hopPositions, hops])

  /**
   * arc별 색상: 증분 RTT 기준.
   * 해당 구간에서 추가된 지연이 클수록 빨간색.
   * RTT 정보가 없는 경우 기본 파란색.
   */
  const arcColors = useMemo(() => {
    if (!hops) return arcCurves.map(() => '#2f81f7')
    return arcCurves.map((curve, i) => {
      if (!curve) return '#2f81f7'
      const toHop   = i < hops.length ? hops[i] : null
      const fromHop = i > 0 ? hops[i - 1] : null
      const toRtt   = toHop   ? avgRtt(toHop)   : null
      const fromRtt = fromHop ? avgRtt(fromHop) : null
      if (toRtt === null) return '#2f81f7'
      const deltaRtt = fromRtt !== null ? Math.max(0, toRtt - fromRtt) : toRtt
      return rttToColor(deltaRtt)
    })
  }, [arcCurves, hops])

  // 화면에 표시할 hop 슬라이스 (showHopMarkers: SSE 중에도 표시)
  const visibleHopsSlice = useMemo(
    () => (showHopMarkers ? hops?.slice(0, visibleHops) ?? [] : []),
    [showHopMarkers, hops, visibleHops],
  )
  const visiblePositionsSlice = useMemo(
    () => hopPositions.slice(0, visibleHopsSlice.length),
    [hopPositions, visibleHopsSlice.length],
  )

  // 줌 레벨 기반 클러스터
  const clusters = useMemo(
    () => buildClusters(visibleHopsSlice, visiblePositionsSlice, clusterThreshold),
    [visibleHopsSlice, visiblePositionsSlice, clusterThreshold],
  )

  const visibleArcCount = showArcs ? Math.min(visibleHops, arcCurves.length) : 0

  return (
    <>
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

      {/* 클러스터 마커 (줌에 따라 자동 분해) */}
      {clusters.map((cluster, ci) => {
        const rep = cluster.hops[0]
        if (rep.location.lat === 0 && rep.location.lng === 0) return null
        return (
          <HopMarker
            key={`cluster-${ci}-${cluster.firstIndex}`}
            position={cluster.centerPos}
            kind="router"
            hopIndex={cluster.firstIndex}
            point={rep.location}
            clusterCount={cluster.hops.length}
            avgRtt={cluster.avgRttMs ?? undefined}
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

      {/* 패킷 파티클 (RTT 기반 속도) */}
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
      <OrbitControls
        enablePan={false}
        minDistance={1.5}
        maxDistance={5}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  )
}
