import { test } from "node:test";
import assert from "node:assert/strict";
import { MovementSession } from "../src/input/movement";

test("simultaneous joystick and height editing commits only on the last release, in either order", () => {
  for (const order of [
    ["stick", "repeat"],
    ["repeat", "stick"],
  ]) {
    const session = new MovementSession();
    session.start("stick");
    session.edit();
    session.start("repeat");
    assert.equal(session.end(order[0], true), false);
    assert.equal(session.active, true);
    assert.equal(session.end(order[1], true), true);
    assert.equal(session.active, false);
    assert.equal(session.end(order[1], true), false);
  }
});

test("selection, cancelled inputs and untouched controls cannot accept a preview", () => {
  const session = new MovementSession();
  session.start("drag");
  assert.equal(session.end("drag", true), false);
  session.start("stick");
  session.start("repeat");
  session.edit();
  assert.equal(session.end("repeat", false), false);
  assert.equal(session.end("stick", true), false);
  session.start("drag");
  session.edit();
  session.cancel();
  assert.equal(session.end("drag", true), false);
  session.start("drag");
  session.edit();
  assert.equal(session.end("drag", true), true);
});
