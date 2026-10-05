import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3, Scene } from "three";
import { catalog } from "../src/engine/catalog";
import { mating, component } from "../src/engine/connections";
import { BrickWorld } from "../src/engine/world";
const pose = (
  id: number,
  x: number,
  y: number,
  z = 0,
  q = new Quaternion(),
) => ({ id, spec: catalog[1], position: new Vector3(x, y, z), rotation: q });
test("stud alignment rejects offset, tilt, inverted surfaces and height errors", () => {
  const lower = pose(1, 0, 0.6);
  assert.equal(mating(pose(2, 0, 2), lower)?.count, 4);
  assert.equal(mating(pose(2, 0.35, 2), lower), null);
  assert.equal(mating(pose(2, 0, 1), lower), null);
  assert.equal(mating(pose(2, 0, 4), lower), null);
  assert.equal(
    mating(
      pose(
        2,
        0,
        2,
        0,
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI),
      ),
      lower,
    ),
    null,
  );
  assert.equal(
    mating(
      pose(
        2,
        0,
        2,
        0,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1),
      ),
      lower,
    ),
    null,
  );
});
test("quarter turns, partial overhang, and transformed assemblies mate", () => {
  const low = pose(1, 0, 0.6);
  assert.equal(mating(pose(2, 1, 2), low)?.count, 2);
  assert.equal(
    mating(
      pose(
        2,
        0,
        2,
        0,
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
      ),
      low,
    )?.count,
    4,
  );
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7),
    upper = pose(2, 0, 2);
  upper.position.applyQuaternion(q);
  upper.rotation.copy(q);
  low.position.applyQuaternion(q);
  low.rotation.copy(q);
  assert.equal(mating(upper, low)?.count, 4);
});
test("graph cut preserves a 3 + 2 assembly and detects alternate paths", () => {
  const edges = [
    { a: 1, b: 2 },
    { a: 2, b: 3 },
    { a: 3, b: 4 },
    { a: 4, b: 5 },
  ];
  assert.equal(component(1, edges, edges[2]).size, 3);
  assert.equal(component(5, edges, edges[2]).size, 2);
  assert.equal(component(1, [...edges, { a: 1, b: 5 }], edges[2]).size, 5);
});
test("real physics: fall, explicitly connect, lift five as one, split into 3 + 2, save/restore", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const base = w.add(catalog[1], "#df553e", new Vector3(0, 4, 0));
  for (let i = 0; i < 600; i++) w.step();
  assert.ok(Math.abs(base.position.y - 0.6) < 0.06);
  assert.equal(w.links.length, 0);
  const chain = [base];
  for (let i = 1; i < 5; i++) {
    const b = w.add(
      catalog[1],
      "#3e7b9b",
      base.position.clone().add(new Vector3(0, i * 1.2 + 0.35, 0)),
    );
    w.grab(b.id);
    assert.ok(w.candidate(b.id));
    assert.ok(w.press(b.id));
    chain.push(b);
  }
  assert.equal(w.links.length, 4);
  for (let i = 0; i < 360; i++) w.step();
  assert.ok(chain[4].position.y > 5.3);
  w.grab(base.id);
  assert.equal(w.held.size, 5);
  assert.ok(
    w.transform(base.id, base.position.clone().add(new Vector3(2, 1, 0))),
  );
  w.release();
  for (let i = 0; i < 240; i++) w.step();
  assert.ok(Math.abs(chain[4].position.distanceTo(base.position) - 4.8) < 0.1);
  const seam = w.links[2];
  assert.ok(w.detach(seam, chain[4].id));
  assert.equal(w.held.size, 2);
  assert.equal(component(base.id, w.links).size, 3);
  assert.equal(w.links.length, 3);
  const snapshot = w.serialize();
  w.restore(snapshot);
  assert.equal(w.bricks.length, 5);
  assert.equal(w.links.length, 3);
  w.world.free();
});
test("held pieces cannot pass through bodies or ground; invalid saves do not erase work", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const a = w.add(catalog[1], "#df553e", new Vector3(0, 0.6, 0));
  const b = w.add(catalog[1], "#3e7b9b", new Vector3(4, 0.6, 0));
  w.grab(b.id);
  assert.equal(w.transform(b.id, a.position), false);
  assert.equal(w.transform(b.id, new Vector3(4, -1, 0)), false);
  assert.throws(() => w.restore({ version: 99 } as any));
  assert.equal(w.bricks.length, 2);
  w.world.free();
});
test("one press connects both supports; separation releases only the shared interface", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const left = w.add(catalog[1], "#df553e", new Vector3(-1, 0.6, 0)),
    right = w.add(catalog[1], "#df553e", new Vector3(1, 0.6, 0)),
    top = w.add(catalog[2], "#3e7b9b", new Vector3(0, 2.1, 0));
  w.grab(top.id);
  assert.ok(w.press(top.id));
  assert.equal(w.links.length, 2);
  assert.equal(component(left.id, w.links).size, 3);
  assert.ok(w.detach(w.links[0], right.id));
  assert.equal(w.links.length, 0);
  assert.equal(w.held.size, 1);
  w.world.free();
});
test("blocked extraction preserves connections; malformed geometry in import is rejected atomically", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const a = w.add(catalog[1], "#df553e", new Vector3(0, 0.6, 0)),
    b = w.add(catalog[1], "#3e7b9b", new Vector3(0, 2.1, 0));
  w.grab(b.id);
  assert.ok(w.press(b.id));
  w.add(catalog[1], "#66846b", new Vector3(0, 3.1, 0));
  assert.equal(w.detach(w.links[0], b.id), false);
  assert.equal(w.links.length, 1);
  const data = w.serialize();
  data.bricks[1].p[0] = 20;
  assert.throws(() => w.restore(data));
  assert.equal(w.bricks.length, 3);
  assert.equal(w.links.length, 1);
  w.world.free();
});

test("swept manual transforms cannot tunnel through a blocker", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(catalog[1], "#df553e", new Vector3(0, 0.6, 0));
  const held = w.add(catalog[1], "#3e7b9b", new Vector3(-4, 0.6, 0));
  w.grab(held.id);
  assert.equal(w.transform(held.id, new Vector3(4, 0.6, 0)), false);
  assert.equal(held.position.x, -4);
  w.world.free();
});

test("one landing produces one impact; resting is silent and a later drop sounds again", async () => {
  const sounds: number[] = [];
  const w = new BrickWorld(new Scene(), (v) => sounds.push(v));
  await w.init();
  const b = w.add(catalog[2], "#df553e", new Vector3(0, 4, 0));
  for (let i = 0; i < 600; i++) w.step();
  assert.equal(sounds.length, 1);
  for (let i = 0; i < 600; i++) w.step();
  assert.equal(sounds.length, 1);
  w.grab(b.id);
  w.transform(b.id, new Vector3(0, 4, 0));
  w.release();
  for (let i = 0; i < 600; i++) w.step();
  assert.equal(sounds.length, 2);
  w.world.free();
});
test("pressing and settling an assembly do not emit impact sounds", async () => {
  const sounds: number[] = [];
  const w = new BrickWorld(new Scene(), (v) => sounds.push(v));
  await w.init();
  w.add(catalog[2], "#df553e", new Vector3(0, 0.6, 0));
  for (let i = 0; i < 240; i++) w.step();
  const top = w.add(catalog[1], "#66846b", new Vector3(0, 2.2, 0));
  w.grab(top.id);
  sounds.length = 0;
  assert.ok(w.press(top.id));
  for (let i = 0; i < 600; i++) w.step();
  assert.equal(sounds.length, 0);
  w.world.free();
});
