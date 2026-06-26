import { useLoader, useThree } from '@react-three/fiber'
import { TextureLoader, SRGBColorSpace } from 'three'

export default function Earth() {
  const texture = useLoader(TextureLoader, '/textures/earth.jpg')
  const { gl } = useThree()

  texture.colorSpace = SRGBColorSpace
  // anisotropy: 비스듬한 각도에서 텍스처가 흐려지는 현상 완화
  texture.anisotropy = gl.capabilities.getMaxAnisotropy()

  return (
    <mesh>
      {/* 세그먼트 64 → 128: 줌인 시 폴리곤 경계 제거 */}
      <sphereGeometry args={[1, 128, 128]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  )
}
