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

test("rapid library creation reserves distinct positions without simulation steps", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  for (let i = 0; i < 60; i++) {
    const b = w.spawnHeld(
      catalog[i % catalog.length],
      "#df553e",
      new Vector3(0, 6, 0),
    );
    assert.ok(b);
    for (const other of w.bricks)
      if (other !== b)
        assert.equal(w.obb(b).intersectsOBB(w.obb(other)), false);
    assert.deepEqual([...w.held], [b.id]);
  }
  for (let i = 0; i < 360; i++) w.step();
  for (const b of w.bricks) {
    assert.ok(b.position.toArray().every(Number.isFinite));
    assert.ok(b.position.y > 0 && b.position.y < 10);
    assert.ok(new Vector3().copy(b.body.linvel()).length() < 1);
  }
  w.world.free();
});
test("spawn considers rotated parts and studs, and keeps a held part when capacity is reached", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const obstacle = w.add(
    catalog[2],
    "#df553e",
    new Vector3(0, 6, 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4),
  );
  const b = w.spawnHeld(catalog[1], "#66846b", new Vector3(0, 6, 0));
  assert.ok(b);
  assert.equal(w.obb(b).intersectsOBB(w.obb(obstacle)), false);
  for (let i = w.bricks.length; i < 250; i++)
    assert.ok(w.spawnHeld(catalog[0], "#66846b"));
  const held = [...w.held];
  assert.equal(w.spawnHeld(catalog[0], "#66846b"), null);
  assert.equal(w.bricks.length, 250);
  assert.deepEqual([...w.held], held);
  w.world.free();
});

test("an already overlapping brick can escape but cannot deepen or enter new blockers", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(catalog[1], "#df553e", new Vector3(0, 6, 0));
  const b = w.add(catalog[1], "#66846b", new Vector3(0.5, 6, 0));
  w.grab(b.id);
  assert.equal(w.transform(b.id, new Vector3(0.3, 6, 0)), false);
  assert.ok(w.transform(b.id, new Vector3(0.8, 6, 0)));
  assert.ok(w.transform(b.id, new Vector3(3, 6, 0)));
  w.add(catalog[1], "#df553e", new Vector3(5, 6, 0));
  assert.equal(w.transform(b.id, new Vector3(7, 6, 0)), false);
  w.world.free();
});
test("coincident bricks and slightly buried bricks can be lifted free", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(catalog[1], "#df553e", new Vector3(0, 6, 0));
  const b = w.add(catalog[1], "#66846b", new Vector3(0, 6, 0));
  w.grab(b.id);
  assert.ok(w.transform(b.id, new Vector3(0, 8, 0)));
  const buried = w.add(catalog[1], "#66846b", new Vector3(5, 0.5, 0));
  w.grab(buried.id);
  assert.equal(w.transform(buried.id, new Vector3(5, 0.4, 0)), false);
  assert.ok(w.transform(buried.id, new Vector3(5, 1, 0)));
  w.world.free();
});

test("spawn avoids stud-only overlap and leaves the selection held when the search is full", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(catalog[1], "#df553e", new Vector3(0, 4.65, 0));
  const b = w.spawnHeld(catalog[1], "#66846b", new Vector3(0, 6, 0));
  assert.ok(b);
  assert.ok(Math.hypot(b.position.x, b.position.z) > 0);
  assert.ok(w.transform(b.id, b.position.clone().add(new Vector3(0, 0.5, 0))));
  // A large imported/custom obstacle occupies the entire bounded search area.
  const obstacle = w.add(catalog[2], "#df553e", new Vector3(0, 6, 0));
  // Override only its bounds to test exhaustion without allocating 36,100 studs.
  obstacle.spec = { ...catalog[2], cols: 190, rows: 190, height: 20 };
  const count = w.bricks.length,
    held = [...w.held];
  assert.equal(w.spawnHeld(catalog[1], "#66846b"), null);
  assert.equal(w.bricks.length, count);
  assert.deepEqual([...w.held], held);
  w.world.free();
});

test("assembly can mate through its bottom member while its top member is selected", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const support = w.add(catalog[2], "#df553e", new Vector3(0, 0.6, 0));
  const bottom = w.add(catalog[1], "#66846b", new Vector3(0, 2.15, 0));
  const top = w.add(catalog[1], "#66846b", new Vector3(0, 3.35, 0));
  w.connect(top, bottom, 4);
  w.grab(top.id);
  const c = w.candidate(top.id);
  assert.equal(c?.upper.id, bottom.id);
  assert.equal(c?.lower.id, support.id);
  assert.ok(Math.abs(c!.fit.position.y - 3) < 1e-6);
  assert.ok(w.press(top.id));
  assert.equal(w.links.length, 2);
  assert.equal(component(top.id, w.links).size, 3);
  assert.ok(Math.abs(top.position.y - bottom.position.y - 1.2) < 1e-6);
  for (let i = 0; i < 240; i++) w.step();
  assert.ok(top.position.y > 2.8);
  w.world.free();
});
test("deleting a middle brick preserves both surviving subassemblies and releases held bodies", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const bricks = Array.from({ length: 5 }, (_, i) =>
    w.add(catalog[1], "#66846b", new Vector3(0, 0.6 + i * 1.2, 0)),
  );
  for (let i = 1; i < 5; i++) w.connect(bricks[i], bricks[i - 1], 4);
  w.grab(bricks[4].id);
  w.remove(bricks[2].id);
  assert.equal(w.bricks.length, 4);
  assert.equal(w.links.length, 2);
  assert.equal(w.held.size, 0);
  assert.equal(component(bricks[0].id, w.links).size, 2);
  assert.equal(component(bricks[4].id, w.links).size, 2);
  assert.ok(w.bricks.every((b) => b.body.isDynamic()));
  w.remove(bricks[2].id);
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(w.bricks.every((b) => b.position.toArray().every(Number.isFinite)));
  w.world.free();
});

test("off-center selected member joins another assembly without losing the internal offset", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const base = w.add(catalog[2], "#df553e", new Vector3(0, 0.6, 0)),
    support = w.add(catalog[2], "#df553e", new Vector3(0, 1.8, 0));
  w.connect(support, base, 8);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.01);
  const bottom = w.add(catalog[1], "#66846b", new Vector3(0.05, 3.35, 0), q);
  const top = w.add(
    catalog[1],
    "#66846b",
    bottom.position.clone().add(new Vector3(1, 1.2, 0).applyQuaternion(q)),
    q,
  );
  w.connect(top, bottom, 2);
  w.grab(top.id);
  assert.ok(w.press(top.id));
  assert.equal(component(top.id, w.links).size, 4);
  assert.equal(w.links.length, 3);
  assert.ok(Math.abs(top.position.x - bottom.position.x - 1) < 1e-5);
  assert.ok(Math.abs(top.position.z - bottom.position.z) < 1e-5);
  assert.ok(Math.abs(bottom.position.y - 3) < 1e-5);
  w.world.free();
});

test("bridge assembly aligns its overhang to a slightly rotated independent support", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const foot = w.add(catalog[1], "#3e7b9b", new Vector3(-2, 0.9, 0));
  const bridge = w.add(catalog[2], "#383c43", new Vector3(-1, 2.1, 0));
  w.connect(bridge, foot, 4);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.08);
  const support = w.add(catalog[1], "#df553e", new Vector3(0.27, 0.6, 0.1), q);
  w.grab(foot.id);
  assert.equal(
    mating(bridge, support),
    null,
    "strict engagement must still reject misalignment",
  );
  const c = w.candidate(foot.id);
  assert.equal(c?.upper.id, bridge.id);
  assert.equal(c?.lower.id, support.id);
  assert.equal(w.links.length, 1, "preview does not connect");
  assert.ok(w.press(foot.id));
  assert.equal(component(foot.id, w.links).size, 3);
  assert.ok(mating(bridge, support, 0.06));
  assert.ok(bridge.rotation.angleTo(support.rotation) < 0.001);
  const relative = foot.position
    .clone()
    .sub(bridge.position)
    .applyQuaternion(bridge.rotation.clone().invert());
  assert.ok(relative.distanceTo(new Vector3(-1, -1.2, 0)) < 1e-5);
  w.world.free();
});

test("five-brick bridge preview is non-mutating and joins from the small selected member", async () => {
  const { readFileSync } = await import("node:fs");
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.restore(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/bridge-alignment.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const selected = w.bricks[2],
    overhang = w.bricks[3],
    support = w.bricks[4];
  w.grab(selected.id);
  const before = w.serialize();
  assert.equal(w.candidate(selected.id)?.upper.id, overhang.id);
  assert.deepEqual(w.serialize(), before);
  assert.ok(w.press(selected.id));
  assert.equal(w.links.length, 4);
  assert.equal(component(selected.id, w.links).size, 5);
  assert.ok(mating(overhang, support, 0.06));
  for (let i = 0; i < 240; i++) w.step();
  assert.equal(w.links.length, 4);
  assert.ok(w.bricks.every((b) => b.position.y > 0.5));
  w.world.free();
});

test("alignment assistance rejects distant, sideways, and blocked approaches", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const support = w.add(catalog[1], "#df553e", new Vector3(0, 0.6, 0));
  const top = w.add(catalog[1], "#383c43", new Vector3(0.49, 2.1, 0.49));
  w.grab(top.id);
  assert.equal(w.candidate(top.id), null, "no long-distance snapping");
  assert.ok(
    w.transform(
      top.id,
      new Vector3(0, 2.1, 0),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3),
    ),
  );
  assert.equal(w.candidate(top.id), null, "large yaw remains invalid");
  assert.ok(w.transform(top.id, new Vector3(0, 2.1, 0), new Quaternion()));
  // A valid bridge cannot press onto a sunken support if its other foot
  // would penetrate the floor. The current upper/foot connection is exact.
  assert.ok(w.transform(top.id, new Vector3(1, 1.8, 0)));
  support.body.setTranslation(new Vector3(0, 0.55, 0), true);
  w.sync();
  const foot = w.add(catalog[1], "#66846b", new Vector3(2, 0.6, 0));
  assert.equal(mating(top, foot)?.count, 2);
  w.connect(top, foot, 2);
  w.grab(top.id);
  const before = w.serialize();
  assert.equal(w.candidate(top.id), null);
  assert.equal(w.press(top.id), false);
  assert.deepEqual(w.serialize(), before);
  assert.equal(component(support.id, w.links).size, 1);
  w.world.free();
});
