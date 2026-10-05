import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3, Scene } from "three";
import { rotationAt } from "../src/engine/rotation";
import { BrickWorld } from "../src/engine/world";
import { catalog } from "../src/engine/catalog";
test("rotation passes through the half turn and reaches the exact target on each world axis", () => {
  for (const axis of [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ]) {
    const from = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3),
      to = new Quaternion().setFromAxisAngle(axis, Math.PI / 2).multiply(from);
    assert.ok(rotationAt(from, to, 0).angleTo(from) < 1e-7);
    assert.ok(
      Math.abs(rotationAt(from, to, 0.5).angleTo(from) - Math.PI / 4) < 1e-7,
    );
    assert.ok(rotationAt(from, to, 1).angleTo(to) < 1e-7);
    assert.ok(rotationAt(from, to, 0.1).angleTo(from) < Math.PI / 4);
  }
});
test("animated rotation preserves connected assembly and stops before an obstacle", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const a = w.add(catalog[2], "#df553e", new Vector3(0, 4, 0)),
    b = w.add(catalog[1], "#66846b", new Vector3(0, 5.2, 0));
  w.connect(b, a, 4);
  w.grab(a.id);
  const from = a.rotation.clone(),
    to = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  for (let i = 1; i <= 30; i++)
    assert.ok(w.transform(a.id, a.position, rotationAt(from, to, i / 30)));
  assert.ok(Math.abs(b.position.distanceTo(a.position) - 1.2) < 1e-6);
  assert.equal(w.links.length, 1);
  w.release();
  w.clear();
  const low = w.add(catalog[2], "#df553e", new Vector3(0, 0.6, 0));
  w.grab(low.id);
  const tilt = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  let blocked = false;
  for (let i = 1; i <= 30; i++)
    if (
      !w.transform(
        low.id,
        low.position,
        rotationAt(new Quaternion(), tilt, i / 30),
      )
    ) {
      blocked = true;
      break;
    }
  assert.ok(blocked);
  assert.ok(low.rotation.angleTo(tilt) > 0.1);
  w.world.free();
});
