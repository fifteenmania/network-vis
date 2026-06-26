import { useLoader } from '@react-three/fiber'
import { TextureLoader } from 'three'

export default function Earth() {
  const texture = useLoader(TextureLoader, '/textures/earth.jpg')

  return (
    <mesh>
      <sphereGeometry args={[1, 64, 64]} />
      {/* meshLambertMaterial은 PBR 없이 빠르고 밝게 렌더링됨 */}
      <meshLambertMaterial map={texture} />
    </mesh>
  )
}
