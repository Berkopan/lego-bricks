import * as T from "three";
import type { Brick, LoweringAlignment } from "../engine/world";

const CORNER_LIFT = 0.025;

/**
 * Four thin guide lines from the held member's lower corners to the exact pose
 * it would occupy after lowering onto the aligned studs.
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
      new T.Float32BufferAttribute(new Float32Array(8 * 3), 3),
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

  show(root: Brick, member: Brick, guide: LoweringAlignment) {
    if (this.disposed || guide.memberId !== member.id) return this.hide();
    const shift = guide.position.clone().sub(root.position);
    shift.y = 0;
    const targetCenter = member.position
      .clone()
      .add(shift)
      .add(new T.Vector3(0, -guide.drop, 0));
    const attribute = this.geometry.getAttribute(
      "position",
    ) as T.BufferAttribute;
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([x, z], index) => {
      const local = new T.Vector3(
        (x * member.spec.cols) / 2,
        -member.spec.height / 2 + CORNER_LIFT,
        (z * member.spec.rows) / 2,
      ).applyQuaternion(member.rotation);
      const start = local.clone().add(member.position);
      const end = local.clone().add(targetCenter);
      attribute.setXYZ(index * 2, start.x, start.y, start.z);
      attribute.setXYZ(index * 2 + 1, end.x, end.y, end.z);
    });
    attribute.needsUpdate = true;
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
