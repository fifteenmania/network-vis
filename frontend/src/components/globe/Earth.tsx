import { useEffect, useRef } from 'react'
import { useTexture } from '@react-three/drei'
import { SRGBColorSpace, Texture } from 'three'

export default function Earth() {
  const texture = useTexture('/textures/earth.jpg') as Texture
  const textureRef = useRef(false)

  useEffect(() => {
    if (texture && !textureRef.current) {
      textureRef.current = true
      texture.colorSpace = SRGBColorSpace
      texture.anisotropy = 16
      texture.needsUpdate = true
    }
  }, [texture])

  return (
    <mesh>
      <sphereGeometry args={[1, 64, 64]} />
      <meshLambertMaterial map={texture} />
    </mesh>
  )
}
