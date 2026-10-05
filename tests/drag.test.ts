import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { dragTarget } from "../src/engine/drag";
test("holding the pointer while repeatedly lifting and lowering never changes X/Z", () => {
  const camera = new PerspectiveCamera(36, 1.6, 0.1, 150);
  camera.position.set(14, 15, 19);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0.1, -0.15), camera);
  const plane = new Plane(new Vector3(0, 1, 0), -0.6),
    offset = new Vector3(0.3, 0, -0.2);
  const initial = dragTarget(ray.ray, plane, offset, 0.6)!;
  for (let i = 0; i < 100; i++) {
    const p = dragTarget(ray.ray, plane, offset, 0.6 + i * 0.12)!;
    assert.equal(p.x, initial.x);
    assert.equal(p.z, initial.z);
    assert.equal(p.y, 0.6 + i * 0.12);
  }
  ray.setFromCamera(new Vector2(0.2, -0.15), camera);
  assert.notEqual(dragTarget(ray.ray, plane, offset, 5)!.x, initial.x);
});
