import { Vector3 } from "three";
import type { BrickWorld, LoweringAlignment } from "./world";

const INFLUENCE_RADIUS = 0.24;
const CENTER_FACTOR = 0.1;
const CAPTURE_RADIUS = 0.035;
const AUTO_LIFT_STEP = 0.2;
const AUTO_LIFT_MAX_PER_MOVE = 2.4;

/**
 * A noticeable but breakable planar detent around a usable connector alignment.
 * Height stays exact. Crossing close to the target lands on its X/Z center,
 * then leaving that center is strongly damped until the user keeps pushing.
 */
export function planarResistance(
  position: Vector3,
  delta: Vector3,
  alignment: Vector3 | null,
) {
  if (!alignment) return delta.clone();
  const toAlignment = new Vector3(
    alignment.x - position.x,
    0,
    alignment.z - position.z,
  );
  const distance = toAlignment.length();
  if (distance > INFLUENCE_RADIUS) return delta.clone();

  const planar = new Vector3(delta.x, 0, delta.z);
  const planarLengthSq = planar.lengthSq();
  if (planarLengthSq < 1e-12)
    return new Vector3(delta.x, delta.y, delta.z);

  // Make the alignment feel like a physical notch instead of only slowing
  // motion: if this input crosses very close to the center, stop on it.
  const along = toAlignment.dot(planar) / planarLengthSq;
  if (along > 0 && along <= 1) {
    const closest = toAlignment
      .clone()
      .addScaledVector(planar, -along)
      .length();
    if (closest <= CAPTURE_RADIUS)
      return new Vector3(toAlignment.x, delta.y, toAlignment.z);
  }

  const influence = Math.max(0, 1 - distance / INFLUENCE_RADIUS);
  const eased = influence * influence * (3 - 2 * influence);
  let factor = 1 - (1 - CENTER_FACTOR) * eased;
  if (distance <= 0.06) factor = Math.min(factor, CENTER_FACTOR);
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
  const planarOnly = Math.abs(target.y - origin.y) < 1e-8;
  let blocked = false;
  let lifted = false;
  for (let i = 1; i <= steps; i++) {
    const desired = origin
      .clone()
      .lerp(target, i / steps)
      .add(offset);
    // Once collision avoidance has raised the held assembly, pointer/joystick
    // motion stays on that new plane instead of trying to descend on each step.
    if (planarOnly) desired.y = brick.position.y;
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
      let cleared = false;
      if (
        planarOnly &&
        Math.hypot(resisted.x, resisted.z) > 1e-8
      ) {
        // A planar drag that runs into another brick climbs in small increments
        // until the same horizontal move clears. This replaces the old eager
        // lift-on-drag-start behavior with collision-driven assistance.
        for (
          let rise = AUTO_LIFT_STEP;
          rise <= AUTO_LIFT_MAX_PER_MOVE + 1e-8;
          rise += AUTO_LIFT_STEP
        ) {
          const raised = brick.position
            .clone()
            .add(new Vector3(0, AUTO_LIFT_STEP, 0));
          if (!world.transform(id, raised)) break;
          lifted = true;
          const liftedNext = next.clone();
          liftedNext.y = brick.position.y;
          if (world.transform(id, liftedNext)) {
            cleared = true;
            break;
          }
        }
      }
      if (!cleared) {
        blocked = true;
        break;
      }
    }
    offset.add(resisted.sub(delta));
  }
  const alignment: LoweringAlignment | null = world.loweringAlignment(id);
  return {
    blocked,
    aligned: !!alignment,
    alignment,
    offset,
    lifted,
    moved: brick.position.distanceToSquared(origin) > 1e-12,
  };
}
