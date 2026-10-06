import * as T from "three";
import type { Brick, LoweringAlignment } from "../engine/world";

const CORNER_LIFT = 0.025;
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Draw the lowering projection for the complete held assembly. Every connected
 * member contributes four thin corner guides to the exact pose it would occupy
 * after the assembly is lowered onto the aligned studs.
 */
export class AlignmentProjection {
  private readonly geometry = new T.BufferGeometry();
  private readonly material = new T.LineDashedMaterial({
    color: 0x3e9f86,
    transparent: true,
    opacity: 0.46,
    dashSize: 0.13,
    gapSize: 0.09,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  private readonly lines = new T.LineSegments(this.geometry, this.material);
  private disposed = false;

  constructor(scene: T.Scene) {
    this.geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(new Float32Array(0), 3),
    );
    this.lines.name = "alignment-projection";
    this.lines.visible = false;
    this.lines.renderOrder = 19;
    this.lines.raycast = () => {};
    scene.add(this.lines);
  }

  get visible() {
    return this.lines.visible;
  }

  show(root: Brick, members: readonly Brick[], guide: LoweringAlignment) {
    if (
      this.disposed ||
      !members.length ||
      !members.some((member) => member.id === guide.memberId)
    )
      return this.hide();

    const shift = guide.position.clone().sub(root.position);
    shift.y = 0;
    const positions = new Float32Array(members.length * CORNERS.length * 2 * 3);
    let cursor = 0;

    for (const member of members) {
      const targetCenter = member.position
        .clone()
        .add(shift)
        .add(new T.Vector3(0, -guide.drop, 0));
      for (const [x, z] of CORNERS) {
        const local = new T.Vector3(
          (x * member.spec.cols) / 2,
          -member.spec.height / 2 + CORNER_LIFT,
          (z * member.spec.rows) / 2,
        ).applyQuaternion(member.rotation);
        const start = local.clone().add(member.position);
        const end = local.clone().add(targetCenter);
        for (const value of [start.x, start.y, start.z, end.x, end.y, end.z])
          positions[cursor++] = value;
      }
    }

    this.geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    this.geometry.computeBoundingSphere();
    this.lines.computeLineDistances();
    this.lines.visible = true;
  }

  hide() {
    this.lines.visible = false;
  }

  dispose() {
    if (this.disposed) return;
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.disposed = true;
  }
}
