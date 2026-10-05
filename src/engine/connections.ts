import { Quaternion, Vector3 } from "three";
import { connectors, type BrickSpec } from "./catalog";
export interface Pose {
  id: number;
  spec: BrickSpec;
  position: Vector3;
  rotation: Quaternion;
}
export interface Link {
  a: number;
  b: number;
}
export function component(
  id: number,
  links: Link[],
  excluded?: Link,
): Set<number> {
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of links) {
      if (e === excluded) continue;
      if (result.has(e.a) && !result.has(e.b)) {
        result.add(e.b);
        changed = true;
      }
      if (result.has(e.b) && !result.has(e.a)) {
        result.add(e.a);
        changed = true;
      }
    }
  }
  return result;
}
/** Only co-oriented stud/socket surfaces and integer pitch offsets can engage. */
export function mating(
  upper: Pose,
  lower: Pose,
  maxGap = 0.65,
  assist = false,
) {
  const inv = lower.rotation.clone().invert();
  const relative = inv.clone().multiply(upper.rotation);
  const up = new Vector3(0, 1, 0).applyQuaternion(relative);
  if (up.y < (assist ? Math.cos(Math.PI / 36) : 0.999)) return null;
  const axis = new Vector3(1, 0, 0).applyQuaternion(relative);
  const yaw = Math.atan2(-axis.z, axis.x),
    quarter = Math.round(yaw / (Math.PI / 2));
  // A held part can approach within 12 degrees; actual contacts and saved links
  // still use the strict tolerances. The press moves to the exact connector pose.
  if (Math.abs(yaw - (quarter * Math.PI) / 2) > (assist ? Math.PI / 15 : 0.025))
    return null;
  const local = upper.position.clone().sub(lower.position).applyQuaternion(inv);
  const height = (upper.spec.height + lower.spec.height) / 2;
  if (local.y < height - 0.06 || local.y > height + maxGap) return null;
  const q = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (quarter * Math.PI) / 2,
  );
  const tops = connectors(lower.spec),
    bottoms = connectors(upper.spec).map((p) =>
      new Vector3(p.x, 0, p.z).applyQuaternion(q),
    );
  let nearest = Infinity,
    dx = 0,
    dz = 0;
  for (const a of tops)
    for (const b of bottoms) {
      const x = a.x - b.x - local.x,
        z = a.z - b.z - local.z,
        d = Math.hypot(x, z);
      if (d < nearest) {
        nearest = d;
        dx = x;
        dz = z;
      }
    }
  if (nearest > (assist ? 0.45 : 0.17)) return null;
  const count = bottoms.filter((b) =>
    tops.some(
      (a) =>
        Math.hypot(a.x - (b.x + local.x + dx), a.z - (b.z + local.z + dz)) <
        0.01,
    ),
  ).length;
  if (!count) return null;
  const position = new Vector3(local.x + dx, height, local.z + dz)
    .applyQuaternion(lower.rotation)
    .add(lower.position);
  return { position, rotation: lower.rotation.clone().multiply(q), count };
}
