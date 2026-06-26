import { useRef } from 'react'
import { Html, Text } from '@react-three/drei'
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

// Tier 2 카드를 마커 위 몇 px에 고정할지 (HTML CSS offset)
const CARD_OFFSET_PX = 50

// 프레임마다 재사용할 임시 벡터
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
  // Tier 1: WebGL Text 배지 — HTML이 아닌 Three.js Group ref
  const badgeGroupRefs = useRef<(THREE.Group | null)[]>([])
  // Tier 2: HTML 상세 카드 (호버/선택 시만, 정지 중 표시 → HTML lag 허용)
  const cardRefs       = useRef<(HTMLDivElement | null)[]>([])

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
      const badgeGroup = badgeGroupRefs.current[i]
      const card       = cardRefs.current[i]

      // 지구 뒷면 감지
      const dot = _tmp.copy(m.position).normalize().dot(_camDir)
      if (dot < 0.1) {
        if (badgeGroup) badgeGroup.visible = false
        if (card)       card.style.opacity = '0'
        return
      }

      // 배지 그룹 스케일 업데이트 (camera.distanceTo(marker)에 비례 → 화면 일정 크기)
      if (badgeGroup) {
        const d = camera.position.distanceTo(m.position)
        badgeGroup.scale.setScalar(d / 2.0)
      }

      // NDC 투영 (마커 위치 기준, 배지 오프셋은 screen-space로 보정)
      _tmp.copy(m.position)
      const ndc = _tmp.project(camera)
      if (ndc.z > 1) {
        if (badgeGroup) badgeGroup.visible = false
        if (card)       card.style.opacity = '0'
        return
      }

      const sx = ( ndc.x * 0.5 + 0.5) * size.width
      const sy = (-ndc.y * 0.5 + 0.5) * size.height - 22  // 배지 위치 근사 보정

      // Tier 1 greedy declutter
      const W = 28, H = 18
      const rect = { x: sx - W / 2, y: sy - H / 2, w: W, h: H }
      const overlaps = placed.some(
        p => rect.x < p.x + p.w && rect.x + rect.w > p.x &&
             rect.y < p.y + p.h && rect.y + rect.h > p.y,
      )
      if (badgeGroup) badgeGroup.visible = !overlaps
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

            {/*
              Tier 1: WebGL Text 배지
              - drei의 <Text>는 troika-three-text 기반 WebGL 렌더링
              - HTML CSS transform 방식의 Html 컴포넌트와 달리 글로브와 동일 프레임에 렌더됨
              - 회전 시 텍스처 표면에 완전히 고정돼 보임 (lag 없음)
              - 그룹 스케일을 useFrame에서 camera.distanceTo(position)/2로 업데이트 →
                줌 레벨과 무관하게 화면상 일정 크기 유지
            */}
            <group
              ref={el => { badgeGroupRefs.current[i] = el as THREE.Group | null }}
              position={[0, 0.075, 0]}
            >
              <Text
                fontSize={0.040}
                color={color}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.006}
                outlineColor="#0a0f1a"
                outlineOpacity={0.92}
              >
                {getBadgeText(kind, hop)}
              </Text>
            </group>

            {/* Tier 2: HTML 상세 카드 (호버/선택 시만 표시, 조작 중단 시 보임) */}
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
