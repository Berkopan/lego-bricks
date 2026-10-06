import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  planarResistance,
  moveWithAlignment,
} from "../src/engine/alignment-motion";
import type { BrickWorld } from "../src/engine/world";

test("horizontal alignment creates a strong detent while leaving height and free movement exact", () => {
  const position = new Vector3(0, 6, 0),
    delta = new Vector3(0.12, 0.24, -0.08);
  assert.deepEqual(planarResistance(position, delta, null), delta);
  assert.deepEqual(
    planarResistance(position, delta, new Vector3(2, 6, 0)),
    delta,
  );
  const resisted = planarResistance(position, delta, position);
  assert(resisted.x > 0 && resisted.x <= delta.x * 0.11);
  assert(resisted.z < 0 && resisted.z >= delta.z * 0.11);
  assert.equal(resisted.y, delta.y);

  const edge = planarResistance(
    new Vector3(0.2, 6, 0),
    new Vector3(0.12, 0.24, 0),
    new Vector3(0, 6, 0),
  );
  assert(edge.x > resisted.x && edge.x < 0.12);
  assert.equal(edge.y, 0.24);
});

test("crossing an alignment lands on its planar center before resisting movement away", () => {
  const alignment = new Vector3(0, 6, 0);
  const crossing = planarResistance(
    new Vector3(-0.08, 6, 0),
    new Vector3(0.16, 0.2, 0.01),
    alignment,
  );
  assert.ok(Math.abs(crossing.x - 0.08) < 1e-12);
  assert.ok(Math.abs(crossing.z) < 1e-12);
  assert.equal(crossing.y, 0.2);

  const leaving = planarResistance(
    alignment,
    new Vector3(0.12, -0.3, 0),
    alignment,
  );
  assert(leaving.x <= 0.0121);
  assert.equal(leaving.y, -0.3);
});

test("absolute-pointer resistance has no stationary-pointer creep and can be overcome", () => {
  const brick = { position: new Vector3(0, 6, 0) };
  const world = {
    get: () => brick,
    loweringAlignment: () =>
      Math.abs(brick.position.x) <= 0.17
        ? {
            position: new Vector3(0, 6, 0),
            lowerId: 2,
            memberId: 1,
            drop: 4,
          }
        : null,
    transform: (_id: number, p: Vector3) => {
      brick.position.copy(p);
      return true;
    },
  } as unknown as BrickWorld;
  const pointer = new Vector3(0.12, 6, 0);
  const result = moveWithAlignment(world, 1, pointer);
  assert(result.aligned);
  assert(result.alignment);
  const heldPosition = brick.position.clone();
  for (let i = 0; i < 10; i++)
    moveWithAlignment(world, 1, pointer.clone().add(result.offset));
  assert(brick.position.distanceTo(heldPosition) < 1e-12);
  for (let i = 0; i < 20; i++)
    moveWithAlignment(
      world,
      1,
      brick.position.clone().add(new Vector3(0.12, 0, 0)),
    );
  assert(
    brick.position.x > 1.5,
    "continued movement breaks out of the alignment detent",
  );
  assert.equal(brick.position.y, 6);
});
