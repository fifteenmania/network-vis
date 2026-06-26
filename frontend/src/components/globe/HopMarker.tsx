import { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTraceStore } from '../../store/traceStore'
import type { GeoPoint, TraceHop } from '../../types/network'

interface HopMarkerProps {
  position: THREE.Vector3
  kind: 'client' | 'router' | 'destination'
  hopIndex: number
  point: GeoPoint   // client/destination 라벨용. router는 hop.location 과 동일.
  hop?: TraceHop    // router 전용: 라벨(hop번호·도시·RTT) 계산에 사용
}

const COLOR = {
  client:      '#3fb950',
  router:      '#8b949e',
  destination: '#2f81f7',
}

const DOT_SIZE = {
  client:      0.016,
  destination: 0.016,
  router:      0.010,
}

export default function HopMarker({
  position,
  kind,
  hopIndex,
  point,
  hop,
}: HopMarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const { selectedHop, selectHop } = useTraceStore()

  const isSelected = selectedHop === hopIndex
  const color      = COLOR[kind]
  const size       = DOT_SIZE[kind]

  // 카메라 거리에 비례해 마커 크기 유지 (줌인/줌아웃 시 화면상 일정 크기)
  useFrame(() => {
    if (!meshRef.current) return
    const dist = camera.position.length()
    meshRef.current.scale.setScalar(dist / 2.8) // 2.8 = 초기 카메라 거리
  })

  // 라벨 텍스트 계산
  const labelText = (() => {
    if (kind !== 'router') {
      return point.label.split(',')[0]
    }
    const city = (hop?.location.label ?? point.label).split(',')[0]
    if (!hop) return city
    const rttAvg = hop.rttMs.length
      ? hop.rttMs.reduce((a, b) => a + b, 0) / hop.rttMs.length
      : null
    const rttText = rttAvg !== null ? `${rttAvg.toFixed(1)}ms` : null
    // "3 · Seongnam-si · 1.2ms"
    return [hop.hop, city, rttText].filter(Boolean).join(' · ')
  })()

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={() => selectHop(isSelected ? null : hopIndex)}
      >
        <sphereGeometry args={[size, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 3 : 1.2}
        />
      </mesh>

      <Html
        position={[0, 0.06, 0]}
        center
        zIndexRange={[10, 0]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          style={{
            background: 'rgba(8,12,20,0.82)',
            border: `1px solid ${color}`,
            borderRadius: 3,
            padding: '1px 6px',
            fontSize: kind === 'router' ? 10 : 11,
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            color,
            whiteSpace: 'nowrap',
            lineHeight: 1.5,
          }}
        >
          {labelText}
        </div>
      </Html>
    </group>
  )
}
