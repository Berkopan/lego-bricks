import { Vector3 } from "three";
import type { OBB } from "three/addons/math/OBB.js";
/** Minimum separating translation along the 15 OBB SAT axes; zero when clear. */
export function overlapDepth(a: OBB, b: OBB) {
  const basis = (box: OBB) =>
    [0, 1, 2].map((i) => new Vector3().fromArray(box.rotation.elements, i * 3));
  const aa = basis(a),
    bb = basis(b),
    axes = [
      ...aa,
      ...bb,
      ...aa.flatMap((x) => bb.map((y) => x.clone().cross(y))),
    ];
  const delta = b.center.clone().sub(a.center);
  let depth = Infinity;
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();
    const radius = (box: OBB, basis: Vector3[]) =>
      basis.reduce(
        (sum, v, i) =>
          sum + Math.abs(v.dot(axis)) * box.halfSize.getComponent(i),
        0,
      );
    depth = Math.min(
      depth,
      radius(a, aa) + radius(b, bb) - Math.abs(delta.dot(axis)),
    );
    if (depth <= 0) return 0;
  }
  return depth;
}
export function bottomOf(box: OBB) {
  const r = box.rotation.elements,
    h = box.halfSize;
  return (
    box.center.y -
    Math.abs(r[1]) * h.x -
    Math.abs(r[4]) * h.y -
    Math.abs(r[7]) * h.z
  );
}
