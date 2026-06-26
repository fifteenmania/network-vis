import { Html } from '@react-three/drei'
import { useTraceStore } from '../../store/traceStore'
import type { GeoPoint } from '../../types/network'
import type * as THREE from 'three'

interface HopMarkerProps {
  position: THREE.Vector3
  kind: 'client' | 'router' | 'destination'
  hopIndex: number
  point: GeoPoint
  /** 1이면 단일 hop, 2+ 이면 클러스터 (배지 표시) */
  clusterCount?: number
  /** 클러스터 평균 RTT (ms) */
  avgRtt?: number
}

const COLOR = {
  client:      '#3fb950',
  router:      '#8b949e',
  destination: '#2f81f7',
}

const DOT_SIZE = {
  client:      0.012,
  destination: 0.012,
  router:      0.007,
}

export default function HopMarker({
  position,
  kind,
  hopIndex,
  point,
  clusterCount = 1,
  avgRtt,
}: HopMarkerProps) {
  const { selectedHop, selectHop } = useTraceStore()
  const isSelected    = selectedHop === hopIndex
  const isCluster     = clusterCount > 1
  const color         = isCluster ? '#e3b341' : COLOR[kind]
  const baseSize      = DOT_SIZE[kind]
  // 클러스터는 크기를 hop 수에 비례해 살짝 키움 (최대 1.8배)
  const size          = isCluster ? baseSize * Math.min(1 + clusterCount * 0.15, 1.8) : baseSize

  // client/destination은 항상 라벨, router는 클러스터일 때만 배지
  const showLabel     = kind !== 'router' || isCluster

  return (
    <group position={position}>
      <mesh onClick={() => selectHop(isSelected ? null : hopIndex)}>
        <sphereGeometry args={[size, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isSelected ? 3 : isCluster ? 1.8 : 1.2}
        />
      </mesh>

      {showLabel && (
        <Html
          position={[0, 0.06, 0]}
          center
          zIndexRange={[10, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {isCluster ? (
            // 클러스터 배지: "N hops · XXms"
            <div
              style={{
                background: 'rgba(8,12,20,0.88)',
                border: `1px solid ${color}`,
                borderRadius: 4,
                padding: '2px 7px',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                color,
                whiteSpace: 'nowrap',
                lineHeight: 1.5,
                display: 'flex',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <span>{clusterCount} hops</span>
              {avgRtt !== undefined && (
                <>
                  <span style={{ opacity: 0.5 }}>·</span>
                  <span>{Math.round(avgRtt)}ms</span>
                </>
              )}
            </div>
          ) : (
            // 단일 client/destination 라벨
            <div
              style={{
                background: 'rgba(8,12,20,0.82)',
                border: `1px solid ${color}`,
                borderRadius: 3,
                padding: '1px 6px',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                color,
                whiteSpace: 'nowrap',
                lineHeight: 1.5,
              }}
            >
              {point.label.split(',')[0]}
            </div>
          )}
        </Html>
      )}
    </group>
  )
}
