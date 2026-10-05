import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion } from "three";
import { BrickWorld } from "../src/engine/world";
import { catalog } from "../src/engine/catalog";
import { component, mating } from "../src/engine/connections";
const spec = (id: string) => catalog.find((s) => s.id === id)!;

test("yellow brick presses upward into the underside of a supported overhang", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const base = w.add(spec("2x4"), "#3e7b9b", new Vector3(-1, 0.6, 0));
  const plate = w.add(spec("plate-2x4"), "#df553e", new Vector3(-1, 1.4, 0));
  const upper = w.add(spec("2x2"), "#df553e", new Vector3(1, 2.2, 0));
  w.connect(plate, base, 8);
  w.connect(upper, plate, 2);
  const lower = w.add(
    spec("1x2"),
    "#e9b938",
    new Vector3(1.5, 0.6, 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
  );
  w.grab(lower.id);
  const before = upper.position.clone();
  const c = w.candidate(lower.id);
  assert.equal(c?.upper.id, upper.id);
  assert.equal(c?.lower.id, lower.id);
  assert.ok(c!.fit.position.y > lower.position.y, "press is upward");
  assert.ok(w.press(lower.id));
  assert.equal(w.links.length, 3);
  assert.ok(
    upper.position.distanceTo(before) < 1e-6,
    "stationary assembly is not repositioned",
  );
  assert.equal(component(lower.id, w.links).size, 4);
  assert.ok(mating(upper, lower, 0.06));
  for (let i = 0; i < 240; i++) w.step();
  w.restore(w.serialize());
  assert.equal(w.links.length, 3);
  w.world.free();
});

test("an off-center held assembly connects upward with its internal offsets preserved", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const upper = w.add(spec("2x4"), "#df553e", new Vector3(0, 4.2, 0));
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.08);
  const member = w.add(spec("2x2"), "#e9b938", new Vector3(0.12, 2.7, 0));
  const root = w.add(spec("1x2"), "#e9b938", new Vector3(0.12, 1.5, 0.5));
  w.connect(member, root, 2);
  w.grab(root.id);
  assert.equal(w.candidate(root.id)?.lower.id, member.id);
  assert.ok(w.press(root.id));
  assert.ok(
    root.position
      .clone()
      .sub(member.position)
      .distanceTo(new Vector3(0, -1.2, 0.5)) < 1e-5,
  );
  assert.equal(component(upper.id, w.links).size, 3);
  w.world.free();
});

test("upward engagement rejects smooth tops and invalid socket areas", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(spec("2x2"), "#df553e", new Vector3(0, 2, 0));
  const tile = w.add(spec("tile-2x2"), "#e9b938", new Vector3(0, 0.9, 0));
  w.grab(tile.id);
  assert.equal(w.candidate(tile.id), null);
  assert.equal(w.press(tile.id), false);
  w.clear();
  w.add(spec("arch-1x4"), "#df553e", new Vector3(0, 2.2, 0));
  const round = w.add(spec("round-1x1"), "#e9b938", new Vector3(0.5, 0.7, 0));
  w.grab(round.id);
  assert.equal(w.candidate(round.id), null, "arch opening has no socket");
  w.world.free();
});
