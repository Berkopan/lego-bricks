import { Vector3 } from "three";
import { mating, type Pose } from "./connections";

/** A horizontal alignment whose final approach only lowers the current pose.
 * Project to the support plane first, so distance above it has no upper limit.
 * Side-facing, upside-down and rotation-assisted connections are not guides.
 */
export function loweringFit(upper: Pose, lower: Pose, radius = 0.24) {
  const normal = new Vector3(0, 1, 0).applyQuaternion(lower.rotation);
  const up = new Vector3(0, 1, 0).applyQuaternion(upper.rotation);
  if (normal.y < 0.999 || up.y < 0.999) return null;
  const height = (upper.spec.height + lower.spec.height) / 2;
  const vertical =
    (lower.position.clone().sub(upper.position).dot(normal) + height) /
    normal.y;
  if (vertical >= -1e-4) return null;
  const projected = {
    ...upper,
    position: upper.position.clone().add(new Vector3(0, vertical, 0)),
  };
  const fit = mating(projected, lower, 0.06, false, radius);
  if (
    !fit ||
    fit.rotation
      .clone()
      .normalize()
      .angleTo(upper.rotation.clone().normalize()) > 0.002 ||
    Math.hypot(
      fit.position.x - upper.position.x,
      fit.position.z - upper.position.z,
    ) > radius ||
    fit.position.y >= upper.position.y - 1e-4
  )
    return null;
  return {
    position: fit.position,
    drop: upper.position.y - fit.position.y,
    count: fit.count,
  };
}
