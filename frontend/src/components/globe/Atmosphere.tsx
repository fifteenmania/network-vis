import { useMemo } from 'react'
import * as THREE from 'three'

export default function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          void main() {
            float rim = 1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0));
            rim = pow(rim, 2.5);
            gl_FragColor = vec4(0.298, 0.765, 0.969, rim * 0.6);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    [],
  )

  return (
    <mesh scale={1.08} material={material}>
      <sphereGeometry args={[1, 32, 32]} />
    </mesh>
  )
}
