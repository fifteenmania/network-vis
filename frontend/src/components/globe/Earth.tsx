import { useLoader, useThree } from '@react-three/fiber'
import { TextureLoader } from 'three'

export default function Earth() {
  const texture = useLoader(TextureLoader, '/textures/earth.jpg')
  const { gl } = useThree()

  // anisotropy: 비스듬한 각도에서 텍스처가 흐려지는 현상 완화
  texture.anisotropy = gl.capabilities.getMaxAnisotropy()

  return (
    <mesh>
      <sphereGeometry args={[1, 128, 128]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  )
}
