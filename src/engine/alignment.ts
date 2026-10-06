import { Vector3 } from "three";
import { mating, type Pose } from "./connections";

const WORLD_UP_MIN = Math.cos(Math.PI / 12);

/**
 * Resolve the connector pose an upper part would reach after a mostly vertical
 * lowering. Use the same assisted mating geometry as nearby Snap so a target
 * that becomes snappable when close does not disappear merely because it is high.
 */
export function loweringFit(upper: Pose, lower: Pose, radius = 0.6) {
  const normal = new Vector3(0, 1, 0).applyQuaternion(lower.rotation);
  const up = new Vector3(0, 1, 0).applyQuaternion(upper.rotation);
  // Projection remains a downward/top-surface affordance, not a side/underside
  // snap search. Small settling angles from physics are intentionally tolerated.
  if (normal.y < WORLD_UP_MIN || up.y < WORLD_UP_MIN) return null;

  const height = (upper.spec.height + lower.spec.height) / 2;
  const vertical =
    (lower.position.clone().sub(upper.position).dot(normal) + height) /
    normal.y;
  if (vertical >= -1e-4) return null;

  const projected = {
    ...upper,
    position: upper.position.clone().add(new Vector3(0, vertical, 0)),
  };
  const fit = mating(projected, lower, 0.06, true, radius);
  if (
    !fit ||
    Math.hypot(
      fit.position.x - upper.position.x,
      fit.position.z - upper.position.z,
    ) > radius ||
    fit.position.y >= upper.position.y - 1e-4
  )
    return null;

  return {
    position: fit.position,
    rotation: fit.rotation,
    drop: upper.position.y - fit.position.y,
    count: fit.count,
  };
}
