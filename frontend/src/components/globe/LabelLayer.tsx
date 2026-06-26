import { useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useTraceStore } from '../../store/traceStore'
import { hoverState } from './hoverState'
import type { GeoPoint, TraceHop } from '../../types/network'

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

export interface LabelMarker {
  position: THREE.Vector3
  kind: 'client' | 'router' | 'destination'
  hopIndex: number
  point: GeoPoint
  hop?: TraceHop
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const COLOR: Record<LabelMarker['kind'], string> = {
  client:      '#3fb950',
  router:      '#8b949e',
  destination: '#2f81f7',
}

// Tier 1 배지를 마커 위 몇 px에 고정할지
const BADGE_OFFSET_PX = 24
// Tier 2 카드를 마커 위 몇 px에 고정할지
const CARD_OFFSET_PX  = 50

// 프레임마다 재사용할 임시 벡터 (GC 최소화)
const _tmp    = new THREE.Vector3()
const _camDir = new THREE.Vector3()

// ---------------------------------------------------------------------------
// 텍스트 계산
// ---------------------------------------------------------------------------

function getBadgeText(kind: LabelMarker['kind'], hop?: TraceHop): string {
  if (kind === 'client')      return 'S'
  if (kind === 'destination') return 'D'
  return String(hop?.hop ?? '?')
}

function getCardText(
  kind: LabelMarker['kind'],
  point: GeoPoint,
  hop?: TraceHop,
): string {
  if (kind !== 'router') return point.label.split(',')[0]
  const city = (hop?.location.label ?? point.label).split(',')[0]
  if (!hop) return city
  const rttAvg = hop.rttMs.length
    ? hop.rttMs.reduce((a, b) => a + b, 0) / hop.rttMs.length
    : null
  const rttText = rttAvg !== null ? `${rttAvg.toFixed(1)} ms` : null
  return [hop.hop, city, rttText].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------
// LabelLayer
// ---------------------------------------------------------------------------

interface Props {
  markers: LabelMarker[]
}

export default function LabelLayer({ markers }: Props) {
  const badgeRefs = useRef<(HTMLDivElement | null)[]>([])
  const cardRefs  = useRef<(HTMLDivElement | null)[]>([])

  const { selectedHop } = useTraceStore()

  useFrame(({ camera, size }) => {
    _camDir.copy(camera.position).normalize()

    // Tier 1 greedy declutter 우선순위 정렬
    const placed: { x: number; y: number; w: number; h: number }[] = []
    const order = markers
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        if (a.m.hopIndex === selectedHop) return -1
        if (b.m.hopIndex === selectedHop) return 1
        if (a.m.kind !== 'router' && b.m.kind === 'router') return -1
        if (b.m.kind !== 'router' && a.m.kind === 'router') return 1
        return a.m.hopIndex - b.m.hopIndex
      })

    order.forEach(({ m, i }) => {
      const badge = badgeRefs.current[i]
      const card  = cardRefs.current[i]

      // 지구 뒷면 감지
      const dot = _tmp.copy(m.position).normalize().dot(_camDir)
      if (dot < 0.1) {
        if (badge) badge.style.opacity = '0'
        if (card)  card.style.opacity  = '0'
        return
      }

      // 마커 NDC 투영 (CSS offset은 screen-space이므로 world offset 없음)
      _tmp.copy(m.position)
      const ndc = _tmp.project(camera)
      if (ndc.z > 1) {
        if (badge) badge.style.opacity = '0'
        if (card)  card.style.opacity  = '0'
        return
      }

      const sx = ( ndc.x * 0.5 + 0.5) * size.width
      // 배지는 CSS로 마커 위 BADGE_OFFSET_PX에 있으므로 그만큼 보정
      const sy = (-ndc.y * 0.5 + 0.5) * size.height - BADGE_OFFSET_PX

      // Tier 1 greedy declutter (작은 rect → 충돌 적음)
      const W = 28, H = 18
      const rect = { x: sx - W / 2, y: sy - H / 2, w: W, h: H }
      const overlaps = placed.some(
        p => rect.x < p.x + p.w && rect.x + rect.w > p.x &&
             rect.y < p.y + p.h && rect.y + rect.h > p.y,
      )
      if (badge) badge.style.opacity = overlaps ? '0' : '1'
      if (!overlaps) placed.push(rect)

      // Tier 2: 선택 또는 호버 시만 표시
      const isActive =
        m.hopIndex === selectedHop ||
        m.hopIndex === hoverState.hopIndex
      if (card) card.style.opacity = isActive ? '1' : '0'
    })
  })

  return (
    <>
      {markers.map((marker, i) => {
        const { position, kind, point, hop, hopIndex } = marker
        const color = COLOR[kind]

        return (
          <group key={`label-${hopIndex}`} position={position}>

            {/* Tier 1: 항상 보이는 번호/S/D 배지 — CSS offset으로 고정 pixel 거리 유지 */}
            <Html
              position={[0, 0, 0]}
              center
              zIndexRange={[10, 0]}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <div
                ref={el => { badgeRefs.current[i] = el }}
                style={{
                  transform: `translateY(-${BADGE_OFFSET_PX}px)`,
                  background: 'rgba(8,12,20,0.88)',
                  border: `1px solid ${color}`,
                  borderRadius: 3,
                  padding: '0 4px',
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 700,
                  color,
                  whiteSpace: 'nowrap',
                  lineHeight: '16px',
                  transition: 'opacity 0.1s',
                }}
              >
                {getBadgeText(kind, hop)}
              </div>
            </Html>

            {/* Tier 2: 호버/선택 시 표시되는 상세 카드 — CSS offset으로 고정 pixel 거리 유지 */}
            <Html
              position={[0, 0, 0]}
              center
              zIndexRange={[20, 0]}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <div
                ref={el => { cardRefs.current[i] = el }}
                style={{
                  transform: `translateY(-${CARD_OFFSET_PX}px)`,
                  background: 'rgba(8,12,20,0.92)',
                  border: `1px solid ${color}`,
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: kind === 'router' ? 10 : 11,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                  color,
                  whiteSpace: 'nowrap',
                  lineHeight: 1.6,
                  opacity: 0,
                  transition: 'opacity 0.12s',
                  boxShadow: `0 0 6px ${color}44`,
                }}
              >
                {getCardText(kind, point, hop)}
              </div>
            </Html>

          </group>
        )
      })}
    </>
  )
}
