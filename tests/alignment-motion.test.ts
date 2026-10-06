import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  planarResistance,
  moveWithAlignment,
} from "../src/engine/alignment-motion";
import type { BrickWorld } from "../src/engine/world";

test("horizontal alignment slows input gently while leaving height and free movement exact", () => {
  const position = new Vector3(0, 6, 0),
    delta = new Vector3(0.12, 0.24, -0.08);
  assert.deepEqual(planarResistance(position, delta, null), delta);
  assert.deepEqual(
    planarResistance(position, delta, new Vector3(2, 6, 0)),
    delta,
  );
  const resisted = planarResistance(position, delta, position);
  assert(resisted.x > 0 && resisted.x < delta.x);
  assert(resisted.z < 0 && resisted.z > delta.z);
  assert.equal(resisted.y, delta.y);
});

test("absolute-pointer resistance has no stationary-pointer creep and can be overcome", () => {
  const brick = { position: new Vector3(0, 6, 0) };
  const world = {
    get: () => brick,
    loweringAlignment: () =>
      Math.abs(brick.position.x) <= 0.17
        ? { position: new Vector3(0, 6, 0) }
        : null,
    transform: (_id: number, p: Vector3) => {
      brick.position.copy(p);
      return true;
    },
  } as unknown as BrickWorld;
  const pointer = new Vector3(0.12, 6, 0);
  const result = moveWithAlignment(world, 1, pointer);
  assert(result.aligned);
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
  assert(brick.position.x > 2, "continued movement leaves the alignment");
  assert.equal(brick.position.y, 6);
});
