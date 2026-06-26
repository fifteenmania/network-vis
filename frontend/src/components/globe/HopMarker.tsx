import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTraceStore } from '../../store/traceStore'
import { hoverState } from './hoverState'
import type { GeoPoint, TraceHop } from '../../types/network'

interface HopMarkerProps {
  position: THREE.Vector3
  kind: 'client' | 'router' | 'destination'
  hopIndex: number
  point: GeoPoint
  hop?: TraceHop
}

const COLOR = {
  client:      '#3fb950',
  router:      '#8b949e',
  destination: '#2f81f7',
}

const DOT_SIZE = {
  client:      0.010,
  destination: 0.010,
  router:      0.007,
}

export default function HopMarker({
  position,
  kind,
  hopIndex,
}: HopMarkerProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const { selectedHop, selectHop } = useTraceStore()

  const isSelected = selectedHop === hopIndex
  const color      = COLOR[kind]
  const size       = DOT_SIZE[kind]

  useFrame(() => {
    if (!meshRef.current) return
    // dist-to-marker 사용: 원근법과 상쇄되어 모든 줌 레벨에서 일정한 화면 픽셀 크기 유지
    // (기존 camera.position.length()은 카메라→원점 거리라 줌인 시 16배 이상 커지는 버그 있음)
    const d = camera.position.distanceTo(position)
    meshRef.current.scale.setScalar(d / 2.0)
  })

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={e => { e.stopPropagation(); selectHop(isSelected ? null : hopIndex) }}
        onPointerOver={e => {
          e.stopPropagation()
          hoverState.hopIndex = hopIndex
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          hoverState.hopIndex = null
          document.body.style.cursor = ''
        }}
      >
        <sphereGeometry args={[size, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 2.2 : 0.7}
        />
      </mesh>
    </group>
  )
}
