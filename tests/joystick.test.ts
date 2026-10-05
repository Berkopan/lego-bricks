import { test } from "node:test";
import assert from "node:assert/strict";
import { JoystickState, stickVector, stickStep } from "../src/input/joystick.ts";

const zero = { x: 0, y: 0 };
test("center and finger jitter do not move a brick", () => {
  assert.deepEqual(stickVector(0, 0, 40), zero);
  assert.deepEqual(stickVector(2, 3, 40), zero);
});
test("gentle deflection gives slower fine positioning", () => {
  const slow = stickVector(10, 0, 40);
  const fast = stickVector(30, 0, 40);
  assert.ok(slow.x > 0 && slow.x < fast.x && fast.x < 1);
  assert.equal(slow.y, 0);
});
test("the stick clamps movement outside the pad and normalizes diagonals", () => {
  assert.deepEqual(stickVector(500, 0, 40), { x: 1, y: 0 });
  const diagonal = stickVector(500, -500, 40);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
});
test("invalid geometry never produces invalid coordinates", () => {
  for (const args of [[0, 0, 0], [10, 0, -1], [NaN, 2, 30], [0, Infinity, 30]])
    assert.deepEqual(stickVector(args[0], args[1], args[2]), zero);
});
test("movement is time based, not display refresh rate based", () => {
  const at60 = stickStep({ x: 1, y: 0 }, 1000 / 60).x * 60;
  const at120 = stickStep({ x: 1, y: 0 }, 1000 / 120).x * 120;
  assert.ok(Math.abs(at60 - at120) < 1e-12);
  assert.ok(Math.abs(at60 - 2.4) < 1e-12);
});
test("an interrupted frame cannot teleport through the scene", () => {
  assert.deepEqual(stickStep({ x: 1, y: 0 }, 3000), { x: 0.12, y: 0 });
  assert.deepEqual(stickStep({ x: 1, y: 0 }, -20), zero);
  assert.deepEqual(stickStep({ x: 1, y: 0 }, NaN), zero);
});
test("only the owning finger can move or release the joystick", () => {
  const state = new JoystickState();
  assert.equal(state.down(3), true);
  state.move(3, 40, 0, 40);
  assert.equal(state.down(8), false);
  state.move(8, -40, 0, 40);
  state.up(8);
  assert.equal(state.pointerId, 3);
  assert.deepEqual(state.vector, { x: 1, y: 0 });
  state.up(3);
  assert.equal(state.pointerId, null);
  assert.deepEqual(state.vector, zero);
});
test("cancel resets movement and ignores orphaned events", () => {
  const state = new JoystickState();
  state.down(1); state.move(1, 30, 10, 40); state.cancel(); state.cancel();
  state.move(1, 40, 0, 40); state.up(1);
  assert.deepEqual(state.vector, zero);
  assert.equal(state.down(2), true);
  assert.deepEqual(state.vector, zero);
});
