import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Vector3,
  Quaternion,
  BufferGeometry,
  LineLoop,
  LineBasicMaterial,
  Raycaster,
} from "three";
import { catalog } from "../src/engine/catalog";
import { seamPoints, visibleSeamHit } from "../src/engine/seams";
const lower = {
  id: 1,
  spec: catalog[2],
  position: new Vector3(0, 0.6, 0),
  rotation: new Quaternion(),
};
const upper = {
  id: 2,
  spec: catalog[1],
  position: new Vector3(1, 1.8, 0),
  rotation: new Quaternion(),
};
test("seam perimeter follows actual overlapping footprint, including overhang", () => {
  const points = seamPoints(upper, lower);
  assert.equal(points.length, 4);
  assert.ok(points.every((p) => Math.abs(p.y - 1.21) < 1e-9));
  assert.ok(Math.min(...points.map((p) => p.x)) > -0.1);
  assert.ok(Math.max(...points.map((p) => p.x)) < 2.1);
  assert.equal(
    seamPoints({ ...upper, position: new Vector3(20, 1.8, 0) }, lower).length,
    0,
  );
});
test("seams rotate and translate with their connected structure", () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.8),
    translation = new Vector3(2, 4, 6);
  const transform = (p: typeof lower) => ({
    ...p,
    position: p.position.clone().applyQuaternion(q).add(translation),
    rotation: q.clone(),
  });
  const expected = seamPoints(upper, lower).map((p) =>
    p.applyQuaternion(q).add(translation),
  );
  const actual = seamPoints(transform(upper), transform(lower));
  actual.forEach((p, i) => assert.ok(p.distanceTo(expected[i]) < 1e-8));
});
test("ray hits the seam edge, not the brick center; hidden seams are rejected", () => {
  const line = new LineLoop(
    new BufferGeometry().setFromPoints(seamPoints(upper, lower)),
    new LineBasicMaterial(),
  );
  line.updateMatrixWorld();
  const ray = new Raycaster(new Vector3(1, 1.21, 5), new Vector3(0, 0, -1));
  ray.params.Line.threshold = 0.08;
  const hit = ray.intersectObject(line)[0];
  assert.ok(hit);
  assert.ok(visibleSeamHit(hit.distance));
  assert.equal(visibleSeamHit(hit.distance, hit.distance - 1), false);
  ray.set(new Vector3(1, 5, 0), new Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(line).length, 0);
  line.geometry.dispose();
  line.material.dispose();
});
