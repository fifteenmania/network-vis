// 호버 상태를 React state 없이 공유하기 위한 module-level mutable object.
// HopMarker의 Three.js 포인터 이벤트가 이 값을 직접 변경하고,
// LabelLayer의 useFrame이 매 프레임 읽는다 → re-render 0.
export const hoverState = { hopIndex: null as number | null }
