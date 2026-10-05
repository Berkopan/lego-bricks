import { Vector3 } from "three";
import type { Pose } from "./connections";
/** Contact perimeter computed in the support's frame and returned in world coordinates. */
export function seamPoints(upper: Pose, lower: Pose) {
  const inverse = lower.rotation.clone().invert();
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) =>
    new Vector3(
      x * (upper.spec.cols / 2 - 0.02),
      -upper.spec.height / 2,
      z * (upper.spec.rows / 2 - 0.02),
    )
      .applyQuaternion(upper.rotation)
      .add(upper.position)
      .sub(lower.position)
      .applyQuaternion(inverse),
  );
  const left = Math.max(
      -lower.spec.cols / 2 + 0.02,
      Math.min(...corners.map((p) => p.x)),
    ),
    right = Math.min(
      lower.spec.cols / 2 - 0.02,
      Math.max(...corners.map((p) => p.x)),
    ),
    back = Math.max(
      -lower.spec.rows / 2 + 0.02,
      Math.min(...corners.map((p) => p.z)),
    ),
    front = Math.min(
      lower.spec.rows / 2 - 0.02,
      Math.max(...corners.map((p) => p.z)),
    );
  if (right <= left || front <= back) return [];
  return [
    [left - 0.035, back - 0.035],
    [right + 0.035, back - 0.035],
    [right + 0.035, front + 0.035],
    [left - 0.035, front + 0.035],
  ].map(([x, z]) =>
    new Vector3(x, lower.spec.height / 2 + 0.01, z)
      .applyQuaternion(lower.rotation)
      .add(lower.position),
  );
}
/** Reject occluded seams rather than detaching through a foreground brick. */
export function visibleSeamHit(
  distance: number,
  frontDistance = Infinity,
  tolerance = 0.12,
) {
  return distance <= frontDistance + tolerance;
}
