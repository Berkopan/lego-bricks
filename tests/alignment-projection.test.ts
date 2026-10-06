import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { catalog } from "../src/engine/catalog";
import type { Brick, LoweringAlignment } from "../src/engine/world";
import { AlignmentProjection } from "../src/scene/alignment-projection";

const spec = catalog.find((part) => part.id === "2x2")!;

function brick(
  id: number,
  position: T.Vector3,
  rotation = new T.Quaternion(),
): Brick {
  return {
    id,
    spec,
    position,
    rotation,
    mesh: new T.Group(),
    color: "#df553e",
    body: {} as Brick["body"],
  };
}

test("alignment projection draws four corner lines to the exact lowering target", () => {
  const scene = new T.Scene();
  const projection = new AlignmentProjection(scene);
  const root = brick(1, new T.Vector3(1.2, 6, 2.4));
  const member = brick(
    2,
    new T.Vector3(-0.8, 4.8, 2.4),
    new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      Math.PI / 2,
    ),
  );
  const guide: LoweringAlignment = {
    position: new T.Vector3(1, 6, 2.1),
    memberId: member.id,
    lowerId: 9,
    drop: 3.2,
  };

  projection.show(root, member, guide);
  assert.equal(projection.visible, true);
  const lines = scene.getObjectByName(
    "alignment-projection",
  ) as T.LineSegments<T.BufferGeometry, T.LineDashedMaterial>;
  const attribute = lines.geometry.getAttribute(
    "position",
  ) as T.BufferAttribute;
  assert.equal(attribute.count, 8);
  assert.equal(lines.material.transparent, true);
  assert.equal(lines.material.depthWrite, false);
  assert.equal(lines.material.depthTest, false);

  const shift = guide.position.clone().sub(root.position);
  shift.y = 0;
  const targetCenter = member.position
    .clone()
    .add(shift)
    .add(new T.Vector3(0, -guide.drop, 0));
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  corners.forEach(([x, z], index) => {
    const local = new T.Vector3(
      (x * member.spec.cols) / 2,
      -member.spec.height / 2 + 0.025,
      (z * member.spec.rows) / 2,
    ).applyQuaternion(member.rotation);
    const start = new T.Vector3().fromBufferAttribute(attribute, index * 2);
    const end = new T.Vector3().fromBufferAttribute(attribute, index * 2 + 1);
    assert.ok(start.distanceTo(local.clone().add(member.position)) < 1e-6);
    assert.ok(end.distanceTo(local.clone().add(targetCenter)) < 1e-6);
  });

  projection.hide();
  assert.equal(projection.visible, false);
  projection.dispose();
  assert.equal(scene.getObjectByName("alignment-projection"), undefined);
});
