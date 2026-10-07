import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Group, Quaternion, Vector3 } from "three";
import { catalog, connectors } from "../src/engine/catalog";
import { brickMesh } from "../src/engine/geometry";
import { GroundSupport } from "../src/engine/ground";

const spec = (id: string) => catalog.find((part) => part.id === id)!;
const rotations = [
  new Quaternion(),
  new Quaternion().setFromEuler(new Euler(0.47, 0.31, 0.39)),
  new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0)),
  new Quaternion().setFromEuler(
    new Euler(Math.PI / 2, Math.PI / 4, Math.PI / 4),
  ),
  ...Array.from({ length: 16 }, (_, i) =>
    new Quaternion().setFromEuler(new Euler(i * 0.73, i * 0.41, i * 0.29)),
  ),
];

test("cached ground support matches precise rendered bounds for every part and pose", () => {
  for (const part of catalog) {
    const mesh = brickMesh(part, "#df553e");
    const support = new GroundSupport(mesh);
    for (const rotation of rotations) {
      mesh.position.set(-17.3, 2.1, 8.7);
      mesh.quaternion.copy(rotation);
      const actual = support.bottom(mesh.position, rotation);
      const expected = new Box3().setFromObject(mesh, true).min.y;
      assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${part.id}: support ${actual}, rendered ${expected}, rotation ${rotation.toArray()}`,
      );
      assert.ok(
        actual >= mesh.position.y - support.radius - 1e-9,
        `${part.id}: broad-phase radius must enclose every orientation`,
      );
    }
  }
});

test("rounded and sloped parts rest on their real surfaces without false corner lifts", () => {
  const rotation = new Quaternion().setFromEuler(
    new Euler(Math.PI / 2, Math.PI / 4, Math.PI / 4),
  );
  for (const id of [
    "round-1x1",
    "round-plate-1x1",
    "slope-2x2",
    "cheese-1x1",
  ]) {
    const mesh = brickMesh(spec(id), "#df553e");
    const support = new GroundSupport(mesh);
    mesh.quaternion.copy(rotation);
    mesh.position.y = -new Box3().setFromObject(mesh, true).min.y;
    assert.ok(
      Math.abs(support.bottom(mesh.position, rotation)) < 1e-9,
      `${id}: actual rendered surface rests at y=0`,
    );
    assert.ok(
      new Box3().setFromObject(mesh).min.y < -0.1,
      `${id}: a transformed geometry bounding box includes empty corners`,
    );
  }
});

test("inverted bricks include stud tips in their ground support", () => {
  const rotation = new Quaternion().setFromEuler(new Euler(Math.PI, 0, 0));
  for (const part of catalog.filter((part) => connectors(part).length > 0)) {
    const support = new GroundSupport(brickMesh(part, "#df553e"));
    const bottom = support.bottom(new Vector3(), rotation);
    assert.ok(
      Math.abs(bottom + part.height / 2 + 0.22) < 1e-7,
      `${part.id}: inverted stud tip must reach the floor before the roof`,
    );
  }
});

test("support uses descendant transforms without baking in the root world pose", () => {
  const mesh = new Group();
  mesh.position.set(12, 4, -9);
  mesh.quaternion.setFromEuler(new Euler(0.3, 0.6, -0.4));
  const part = brickMesh(spec("2x4"), "#df553e");
  part.position.set(0.4, -0.7, 0.2);
  part.quaternion.setFromEuler(new Euler(0.7, -0.4, 0.3));
  part.scale.set(0.8, 1.1, 1.3);
  mesh.add(part);
  const support = new GroundSupport(mesh);
  for (const rotation of rotations) {
    mesh.position.set(-3, 7, 2);
    mesh.quaternion.copy(rotation);
    const expected = new Box3().setFromObject(mesh, true).min.y;
    assert.ok(
      Math.abs(support.bottom(mesh.position, rotation) - expected) < 1e-9,
      "all descendant mesh transforms must remain relative to the root",
    );
  }
});

test("floor-edge checks use projected rendered extents instead of an enclosing sphere", () => {
  for (const part of catalog) {
    const mesh = brickMesh(part, "#df553e");
    const support = new GroundSupport(mesh);
    assert.ok(support.overlapsFloor(new Vector3(), new Quaternion()));
    assert.equal(
      support.overlapsFloor(new Vector3(150, 0, 0), new Quaternion()),
      false,
    );
    for (const rotation of rotations.slice(0, 4)) {
      mesh.position.set(0, 0, 0);
      mesh.quaternion.copy(rotation);
      const bounds = new Box3().setFromObject(mesh, true);
      for (const axis of ["x", "z"] as const)
        for (const side of [-1, 1])
          for (const gap of [-0.02, 0.02]) {
            const edge = side > 0 ? bounds.min[axis] : bounds.max[axis];
            const position = new Vector3();
            position[axis] = side * 100 - edge + side * gap;
            assert.equal(
              support.overlapsFloor(position, rotation),
              gap < 0,
              `${part.id}: ${axis} edge ${side}, gap ${gap}, rotation ${rotation.toArray()}`,
            );
          }
    }
  }
  const support = new GroundSupport(brickMesh(spec("2x2"), "#df553e"));
  assert.ok(support.radius > 1.1);
  assert.equal(
    support.overlapsFloor(new Vector3(101.1, 0.6, 0), new Quaternion()),
    false,
    "a 2x2 at x=101.1 is entirely outside the floor despite its larger radius",
  );
});
