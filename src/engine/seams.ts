import { Vector3 } from "three";
import { connectors } from "./catalog";
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

/** Irregular parts outline their actual contacts, not the empty bounding box. */
export function seamSegments(upper: Pose, lower: Pose) {
  const pairs = (points: Vector3[]) =>
    points.flatMap((p, i) => [p, points[(i + 1) % points.length]]);
  if (!upper.spec.shape && !lower.spec.shape)
    return pairs(seamPoints(upper, lower));
  const inverse = lower.rotation.clone().invert();
  const sockets = connectors(upper.spec, "bottom").map((p) =>
    new Vector3(p.x, -upper.spec.height / 2, p.z)
      .applyQuaternion(upper.rotation)
      .add(upper.position)
      .sub(lower.position)
      .applyQuaternion(inverse),
  );
  const contacts = connectors(lower.spec).filter((p) =>
    sockets.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.08),
  );
  const world = (x: number, z: number) =>
    new Vector3(x, lower.spec.height / 2 + 0.01, z)
      .applyQuaternion(lower.rotation)
      .add(lower.position);
  const round = [upper.spec, lower.spec].some((s) => s.shape === "round");
  if (round)
    return contacts.flatMap((p) =>
      pairs(
        Array.from({ length: 24 }, (_, i) =>
          world(
            p.x + Math.cos((i * Math.PI) / 12) * 0.495,
            p.z + Math.sin((i * Math.PI) / 12) * 0.495,
          ),
        ),
      ),
    );
  return contacts.flatMap((p) => {
    const points = [
      [p.x - 0.5, p.z - 0.5],
      [p.x + 0.5, p.z - 0.5],
      [p.x + 0.5, p.z + 0.5],
      [p.x - 0.5, p.z + 0.5],
    ];
    return points.flatMap(([x, z], i) => {
      const [nx, nz] = points[(i + 1) % 4];
      const midX = (x + nx) / 2,
        midZ = (z + nz) / 2;
      const neighbour = contacts.some(
        (o) =>
          o !== p &&
          Math.hypot(o.x - (2 * midX - p.x), o.z - (2 * midZ - p.z)) < 0.01,
      );
      return neighbour ? [] : [world(x, z), world(nx, nz)];
    });
  });
}
