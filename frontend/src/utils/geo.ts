import * as THREE from 'three'

export function latLngToVector3(lat: number, lng: number, radius = 1): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

/**
 * 두 점 사이 거리가 이 값 미만이면 arc를 그리지 않습니다.
 * 0.08 ≈ 510km. 이 미만의 거리에서는 arcHeight가 dist보다 커져
 * 스파이크 모양이 됩니다.
 */
const MIN_ARC_DIST = 0.08

/**
 * 두 점 사이의 호(arc) 곡선을 반환합니다.
 *
 * arcHeight 설계 원칙:
 * 1. 지표면 통과 방지: arcHeight ≥ minHeight = 1 − cos(θ/2)
 * 2. 스파이크 방지: arcHeight는 dist에 비례 (너비보다 높이가 크면 스파이크)
 *    → arcHeight = max(dist × 0.35, minHeight + 0.05)
 *
 * dist = 2·sin(θ/2)  →  cos(θ/2) = √(1 − (dist/2)²)
 */
export function buildArcCurve(
  from: THREE.Vector3,
  to: THREE.Vector3,
): THREE.QuadraticBezierCurve3 | null {
  const dist = from.distanceTo(to)
  if (dist < MIN_ARC_DIST) return null

  const minHeight = 1 - Math.sqrt(Math.max(0, 1 - (dist / 2) ** 2))
  const arcHeight = Math.max(dist * 0.35, minHeight + 0.05)

  const mid = from.clone().add(to).multiplyScalar(0.5)
  const radius = from.length()
  mid.normalize().multiplyScalar(radius * (1 + arcHeight))
  return new THREE.QuadraticBezierCurve3(from, mid, to)
}
