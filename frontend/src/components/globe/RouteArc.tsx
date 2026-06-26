import { useMemo } from 'react'
import * as THREE from 'three'

interface RouteArcProps {
  curve: THREE.QuadraticBezierCurve3
  color?: string
  opacity?: number
}

export default function RouteArc({ curve, color = '#2f81f7', opacity = 0.7 }: RouteArcProps) {
  const lineObj = useMemo(() => {
    const points = curve.getPoints(60)
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    return new THREE.Line(geometry, material)
  }, [curve, color, opacity])

  return <primitive object={lineObj} />
}
