import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

interface RouteArcProps {
  curve: THREE.QuadraticBezierCurve3
  color?: string
  opacity?: number
}

// arc 접선 방향으로 cone을 회전시키기 위한 Y 기준 벡터
const _up = new THREE.Vector3(0, 1, 0)

export default function RouteArc({ curve, color = '#2f81f7', opacity = 0.7 }: RouteArcProps) {
  const arrowRef = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  // arc 라인 geometry
  const lineObj = useMemo(() => {
    const points = curve.getPoints(60)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    return new THREE.Line(geometry, material)
  }, [curve, color, opacity])

  // arrowhead 위치·방향 (arc의 88% 지점, 접선 방향으로 정렬)
  const arrowData = useMemo(() => {
    const t   = 0.88
    const pos = curve.getPoint(t)
    const tan = curve.getTangent(t).normalize()
    const q   = new THREE.Quaternion().setFromUnitVectors(_up, tan)
    return { pos, q }
  }, [curve])

  // HopMarker와 동일한 dist-to-point 기반 일정 화면 크기 유지
  useFrame(() => {
    if (!arrowRef.current) return
    const d = camera.position.distanceTo(arrowData.pos)
    arrowRef.current.scale.setScalar(d / 2.0)
  })

  return (
    <>
      <primitive object={lineObj} />
      <mesh
        ref={arrowRef}
        position={arrowData.pos}
        quaternion={arrowData.q}
      >
        {/* args: [bottomRadius, height, radialSegments] */}
        <coneGeometry args={[0.007, 0.020, 6]} />
        <meshBasicMaterial color={color} transparent opacity={Math.min(1, opacity + 0.2)} />
      </mesh>
    </>
  )
}
