import { Vector3 } from "three";
import type { BrickWorld } from "./world";

/** A light, finite drag over a usable connector alignment. Height stays independent. */
export function planarResistance(
  position: Vector3,
  delta: Vector3,
  alignment: Vector3 | null,
) {
  if (!alignment) return delta.clone();
  const distance = Math.hypot(
    position.x - alignment.x,
    position.z - alignment.z,
  );
  const influence = Math.max(0, 1 - distance / 0.18);
  const factor = 1 - 0.55 * influence;
  return new Vector3(delta.x * factor, delta.y, delta.z * factor);
}

/** Preserve the existing swept movement, adding resistance only to planar input.
 * The returned offset is consumed by absolute pointer drags so a stationary
 * pointer does not slowly creep toward its unresisted target.
 */
export function moveWithAlignment(
  world: BrickWorld,
  id: number,
  target: Vector3,
) {
  const brick = world.get(id);
  const origin = brick.position.clone();
  const steps = Math.max(1, Math.ceil(origin.distanceTo(target) / 0.15));
  const offset = new Vector3();
  let blocked = false;
  let aligned = false;
  for (let i = 1; i <= steps; i++) {
    const desired = origin
      .clone()
      .lerp(target, i / steps)
      .add(offset);
    const delta = desired.clone().sub(brick.position);
    const alignment =
      Math.hypot(delta.x, delta.z) > 1e-8 ? world.loweringAlignment(id) : null;
    const resisted = planarResistance(
      brick.position,
      delta,
      alignment?.position ?? null,
    );
    const next = brick.position.clone().add(resisted);
    if (!world.transform(id, next)) {
      blocked = true;
      break;
    }
    offset.add(resisted.sub(delta));
    aligned ||= !!alignment;
  }
  return {
    blocked,
    aligned,
    offset,
    moved: brick.position.distanceToSquared(origin) > 1e-12,
  };
}
