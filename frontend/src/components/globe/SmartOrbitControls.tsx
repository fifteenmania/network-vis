import { useRef, useEffect } from 'react'
import { OrbitControls } from '@react-three/drei'
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
 *   'change' 이벤트(줌·회전 시 발생)에서만 업데이트 — useFrame 폴링 없음.
 *
 * 책임 2 — 카메라 자동 이동:
 *   camTarget prop 이 null → Vector3 로 바뀔 때 카메라를 해당 위치로 이동한다.
 *   OrbitControls.update() 는 호출 시점의 camera.position 을 읽어 내부
 *   spherical 좌표를 재계산하므로, position.copy() 후 update() 호출로 동기화한다.
 */
export default function SmartOrbitControls({ camTarget }: SmartOrbitControlsProps) {
  const ref = useRef<OrbitControlsImpl>(null)

  // rotateSpeed: 매 프레임 폴링 대신 컨트롤 변경 이벤트로 처리
  useEffect(() => {
    const ctrl = ref.current
    if (!ctrl) return

    const handleChange = () => {
      ctrl.rotateSpeed = ctrl.object.position.length() * 0.18
      // distance 2.8(초기) → speed ≈ 0.50
      // distance 1.5(최근접) → speed ≈ 0.27
      // distance 5.0(최원) → speed ≈ 0.90
    }

    ctrl.addEventListener('change', handleChange)
    return () => { ctrl.removeEventListener('change', handleChange) }
  }, []) // mount/unmount 시 한 번만 등록·해제

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
      minDistance={1.5}
      maxDistance={5}
      enableDamping
      dampingFactor={0.08}
    />
  )
}
