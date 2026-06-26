import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import type { QuadraticBezierCurve3 } from 'three'

interface PacketParticleProps {
  curve: QuadraticBezierCurve3
  color?: string
  speed?: number
  offset?: number
}

export default function PacketParticle({
  curve,
  color = '#facc15',
  speed = 0.4,
  offset = 0,
}: PacketParticleProps) {
  const ref = useRef<Mesh>(null)
  const tRef = useRef(offset % 1)

  useFrame((_, delta) => {
    tRef.current = (tRef.current + delta * speed) % 1
    const pos = curve.getPoint(tRef.current)
    if (ref.current) {
      ref.current.position.copy(pos)
    }
  })

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.012, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} />
    </mesh>
  )
}
