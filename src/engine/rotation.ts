import { MathUtils, Quaternion } from "three";
export const TURN_DURATION_MS = 360;
/** Ease a rigid orientation, including the final exact target, without Euler jumps. */
export function rotationAt(from: Quaternion, to: Quaternion, progress: number) {
  const t = MathUtils.clamp(progress, 0, 1);
  return from.clone().slerp(to, t * t * (3 - 2 * t));
}
