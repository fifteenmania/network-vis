import { useRef, useEffect } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface SmartOrbitControlsProps {
  camTarget: THREE.Vector3 | null
}

/**
 * OrbitControls 래퍼.
 *
 * 책임 1 — rotateSpeed 동적 조정:
 *   줌인할수록 같은 라디안 회전이 화면상 빠르게 느껴지는 문제를 완화한다.
 *   useFrame에서 매 프레임 갱신 (onChange 방식은 R3F ref 타이밍 버그로 폐기).
 *
 * 책임 2 — 카메라 자동 이동:
 *   camTarget prop 이 null → Vector3 로 바뀔 때 카메라를 해당 위치로 이동한다.
 *   OrbitControls.update() 는 호출 시점의 camera.position 을 읽어 내부
 *   spherical 좌표를 재계산하므로, position.copy() 후 update() 호출로 동기화한다.
 */
export default function SmartOrbitControls({ camTarget }: SmartOrbitControlsProps) {
  const ref = useRef<OrbitControlsImpl>(null)

  // rotateSpeed: useFrame으로 매 프레임 보장 업데이트.
  // onChange 이벤트 방식은 R3F에서 마운트 타이밍에 따라 ref.current가 null이어서
  // 리스너가 붙지 않는 버그가 있었다. useFrame은 컴포넌트가 살아있는 동안 항상 실행.
  useFrame(() => {
    const ctrl = ref.current
    if (!ctrl) return
    // 체감 회전속도는 카메라↔지구 표면 거리에 비례해야 한다.
    // dist * k (원점 거리 기준) 는 표면 근접 시 perspective 배율을 보정하지 못해
    // 줌인할수록 화면상 빠르게 느껴지는 버그가 있었다.
    const dist = ctrl.object.position.length()
    const surfaceDist = Math.max(0.05, dist - 1.0)  // 카메라↔표면 거리 (최소 0.05 floor)
    ctrl.rotateSpeed = surfaceDist * 0.35
    // surfaceDist=1.80 (dist=2.8, 기본) → speed ≈ 0.63
    // surfaceDist=0.20 (dist=1.2)       → speed ≈ 0.07
    // surfaceDist=0.05 (dist=1.05, 최근접, floor) → speed ≈ 0.018
  })

  // camTarget 변경 시 카메라 이동
  useEffect(() => {
    const ctrl = ref.current
    if (!ctrl || !camTarget) return
    ctrl.object.position.copy(camTarget)
    ctrl.target.set(0, 0, 0)
    ctrl.update()
  }, [camTarget])

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan={false}
      minDistance={1.05}
      maxDistance={5}
      enableDamping
      dampingFactor={0.08}
    />
  )
}
