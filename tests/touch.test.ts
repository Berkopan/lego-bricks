import { test } from "node:test";
import assert from "node:assert/strict";
import { TouchGestures, type TouchPoint, type TouchPair } from "../src/input/touch.ts";
const p = (pointerId: number, clientX = 0, clientY = 0): TouchPoint => ({ pointerId, clientX, clientY });
function fixture(hit = true) {
  const calls = { start: [] as TouchPoint[], move: [] as TouchPoint[], end: 0, commit: [] as boolean[], orbit: [] as number[][], pinch: [] as [TouchPair, TouchPair][] };
  const gesture = new TouchGestures({
    start: point => { calls.start.push(point); return hit; },
    move: point => calls.move.push(point),
    end: commit => { calls.end++; calls.commit.push(commit); },
    orbit: (x, y) => calls.orbit.push([x, y]),
    panZoom: (a, b) => calls.pinch.push([a, b]),
  });
  return { gesture, calls };
}
test("a tap and normal finger jitter select without lifting or moving", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1, 20, 30)); g.move(p(1, 25, 34)); g.up(1);
  assert.equal(c.start.length, 1); assert.equal(c.move.length, 0);
  assert.equal(c.end, 1); assert.equal(c.orbit.length, 0);
  assert.deepEqual(c.commit, [false], "selecting without moving cannot snap");
});
test("dragging belongs to the initial pointer and never also orbits", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.move(p(99, 200)); g.move(p(1, 15)); g.move(p(1, 16)); g.up(99); g.up(1);
  assert.deepEqual(c.move, [p(1, 15), p(1, 16)]);
  assert.equal(c.orbit.length, 0); assert.equal(c.end, 1);
  assert.deepEqual(c.commit, [true]);
});
test("empty space orbits after the tap threshold", () => {
  const { gesture: g, calls: c } = fixture(false);
  g.down(p(1)); g.move(p(1, 5)); g.move(p(1, 20, 10)); g.up(1);
  assert.deepEqual(c.orbit, [[15, 10]]); assert.equal(c.end, 0);
});
test("camera mode never picks a brick even when the initial finger hits it", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1), true); g.move(p(1, 20)); g.up(1);
  assert.equal(c.start.length, 0); assert.deepEqual(c.orbit, [[20, 0]]);
});
test("adding a second finger transfers ownership from a brick to the camera", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.move(p(1, 20)); g.down(p(2, 100)); g.move(p(2, 140, 20));
  assert.equal(c.end, 1); assert.equal(c.move.length, 1);
  assert.deepEqual(c.commit, [false], "camera takeover cannot snap");
  assert.equal(c.pinch.length, 1);
  assert.deepEqual(c.pinch[0][0], { x: 60, y: 0, distance: 80 });
  assert.deepEqual(c.pinch[0][1], { x: 80, y: 10, distance: Math.hypot(120, 20) });
});
test("a second finger arriving before the drag threshold never moves the brick", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.down(p(2, 60)); g.move(p(1, -20)); g.up(2); g.up(1);
  assert.equal(c.move.length, 0); assert.equal(c.end, 1); assert.equal(c.pinch.length, 1);
  assert.deepEqual(c.commit, [false]);
});
test("the last finger after a pinch cannot unexpectedly drag or orbit", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.down(p(2, 50)); g.up(1); g.move(p(2, 150)); g.up(2);
  assert.equal(c.move.length, 0); assert.equal(c.orbit.length, 0); assert.equal(c.pinch.length, 0);
  assert.deepEqual(c.commit, [false], "lifting after a pinch never commits the earlier drag");
  g.down(p(3)); g.move(p(3, 20)); g.up(3);
  assert.equal(c.move.length, 1); assert.equal(c.end, 2);
});
test("both orders of lifting fingers terminate a pinch cleanly", () => {
  for (const first of [1, 2]) {
    const { gesture: g, calls: c } = fixture();
    g.down(p(1)); g.down(p(2, 50)); g.up(first); g.up(first === 1 ? 2 : 1);
    assert.deepEqual(g.ids, []); assert.equal(c.end, 1);
    g.down(p(3), true); g.move(p(3, 20)); assert.equal(c.orbit.length, 1);
  }
});
test("cancellation is idempotent and ignores orphaned moves and releases", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.move(p(1, 20)); g.cancel(); g.cancel(); g.move(p(1, 40)); g.up(1);
  assert.equal(c.end, 1); assert.equal(c.move.length, 1); assert.deepEqual(g.ids, []);
  assert.deepEqual(c.commit, [false]);
  g.down(p(2)); g.move(p(2, 30)); g.up(2); assert.equal(c.end, 2);
  assert.deepEqual(c.commit, [false, true]);
});
test("third fingers do not jitter the camera and a replacement pair is rebased", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.down(p(2, 50)); g.down(p(3, 100)); g.move(p(3, 300));
  assert.equal(c.pinch.length, 0); g.up(1); g.move(p(3, 310));
  assert.equal(c.pinch.length, 1); assert.equal(c.pinch[0][0].distance, 250);
  assert.equal(c.pinch[0][1].distance, 260); assert.equal(c.end, 1);
});
test("duplicate downs cannot reselect a brick or replace the gesture origin", () => {
  const { gesture: g, calls: c } = fixture();
  g.down(p(1)); g.down(p(1, 200)); g.move(p(1, 10)); g.up(1);
  assert.equal(c.start.length, 1); assert.deepEqual(c.move, [p(1, 10)]);
});
test("coincident touches never produce a zero divisor for zoom", () => {
  const { gesture: g, calls: c } = fixture(false);
  g.down(p(1)); g.down(p(2)); g.move(p(2, 10));
  assert.equal(c.pinch[0][0].distance, 1); assert.equal(c.pinch[0][1].distance, 10);
});

test("selecting a different brick may cancel previous scene input without cancelling the new touch", () => {
  const moves: TouchPoint[] = [], ends: boolean[] = [];
  const gesture = new TouchGestures({
    start: () => { gesture.cancel(); return true; },
    move: point => moves.push(point),
    end: commit => ends.push(commit),
    orbit: () => {}, panZoom: () => {},
  });
  gesture.down(p(1));
  assert.deepEqual(gesture.ids, [1]);
  gesture.move(p(1, 20));
  gesture.up(1);
  assert.deepEqual(moves, [p(1, 20)]);
  assert.deepEqual(ends, [true]);
});
