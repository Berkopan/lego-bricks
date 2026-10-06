import { test } from "node:test";
import assert from "node:assert/strict";
import { Euler, OrthographicCamera, Quaternion, Vector3 } from "three";
import { fitManualCamera } from "../src/manual/render";

function envelope(size: Vector3, rotation: Quaternion, offset: Vector3) {
  return [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) =>
        new Vector3((x * size.x) / 2, (y * size.y) / 2, (z * size.z) / 2)
          .applyQuaternion(rotation)
          .add(offset),
      ),
    ),
  );
}

const near = (a: number, b: number, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} should be close to ${b}`);

test("manual cameras fit tall, wide and oblique world geometry in every projection without clipping", () => {
  const rotation = new Quaternion().setFromEuler(new Euler(0.63, 1.17, -0.44));
  const translation = new Vector3(812, -207, 389);
  const models = [
    envelope(new Vector3(4, 80, 2), rotation, translation),
    envelope(new Vector3(140, 1.2, 4), rotation, translation),
    [
      ...envelope(
        new Vector3(4, 1.2, 2),
        new Quaternion(),
        new Vector3(-90, 0.6, -30),
      ),
      ...envelope(new Vector3(2, 14, 2), rotation, new Vector3(80, 12, 40)),
    ],
  ];
  const views = [
    { position: new Vector3(8, 7, 10), up: new Vector3(0, 1, 0) },
    { position: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
    { position: new Vector3(-1, 0.03, 0), up: new Vector3(0, 1, 0) },
  ];
  for (const points of models) {
    const original = points.map((point) => point.toArray());
    for (const { position, up } of views)
      for (const [width, height] of [
        [1200, 700],
        [360, 840],
      ]) {
        const camera = new OrthographicCamera();
        camera.up.copy(up);
        camera.position.copy(position);
        camera.lookAt(0, 0, 0);
        const direction = camera.getWorldDirection(new Vector3());
        const pixelsPerUnit = fitManualCamera(
          camera,
          points,
          width,
          height,
          0.12,
        );
        assert.ok(Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0);
        near(pixelsPerUnit, width / (camera.right - camera.left));
        near(pixelsPerUnit, height / (camera.top - camera.bottom));
        near(camera.getWorldDirection(new Vector3()).dot(direction), 1);
        assert.deepEqual(camera.up.toArray(), up.toArray());
        for (const point of points) {
          const screen = point.clone().project(camera);
          assert.ok(Math.abs(screen.x) <= 1 / 1.24 + 1e-8, `x=${screen.x}`);
          assert.ok(Math.abs(screen.y) <= 1 / 1.24 + 1e-8, `y=${screen.y}`);
          assert.ok(Math.abs(screen.z) < 1, `depth=${screen.z}`);
        }
      }
    assert.deepEqual(
      points.map((point) => point.toArray()),
      original,
    );
  }
});

test("moving a model in world space preserves its illustrated composition and scale", () => {
  const points = envelope(
    new Vector3(4, 3.6, 2),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.39),
    new Vector3(2, 1.8, -3),
  );
  const shift = new Vector3(-350, 710, 120);
  const moved = points.map((point) => point.clone().add(shift));
  const camera = new OrthographicCamera();
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 0, 0);
  const scale = fitManualCamera(camera, points, 1200, 800);
  const projections = points.map((point) => point.clone().project(camera));
  const shiftedScale = fitManualCamera(camera, moved, 1200, 800);
  near(shiftedScale, scale);
  moved.forEach((point, index) => {
    const projected = point.clone().project(camera);
    near(projected.x, projections[index].x);
    near(projected.y, projections[index].y);
    near(projected.z, projections[index].z);
  });
});

test("a single-point frame stays finite while an empty frame is rejected", () => {
  const camera = new OrthographicCamera();
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 0, 0);
  const point = new Vector3(14, 32, -8);
  assert.ok(fitManualCamera(camera, [point], 240, 180) > 0);
  const projected = point.clone().project(camera);
  near(projected.x, 0);
  near(projected.y, 0);
  assert.ok(Math.abs(projected.z) < 1);
  assert.throws(() => fitManualCamera(camera, [], 240, 180), /empty/);
});
