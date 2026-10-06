import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Scene, Vector3 } from "three";
import { catalog } from "../src/engine/catalog";
import { BrickWorld } from "../src/engine/world";

const spec = (id: string) => catalog.find((part) => part.id === id)!;
async function scene() {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  return world;
}

test("a high projection guides horizontal alignment without lowering, snapping or mutating", async () => {
  const world = await scene();
  const lower = world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.1, 1000, 0.1));
  world.grab(upper.id);
  const before = world.serialize();
  assert.equal(world.snapCandidate(upper.id), null);
  const guide = world.loweringAlignment(upper.id)!;
  assert.ok(guide);
  assert.equal(guide.lowerId, lower.id);
  assert.ok(guide.position.distanceTo(new Vector3(0, 1000, 0)) < 1e-5);
  assert.ok(Math.abs(guide.drop - 998.2) < 1e-4);
  assert.deepEqual(world.serialize(), before);
  world.world.free();
});

test("guide follows a lower assembly member while preserving the selected member height", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const bottom = world.add(spec("2x2"), "#66846b", new Vector3(0.1, 6, 0.1));
  const root = world.add(spec("2x2"), "#66846b", new Vector3(1.1, 7.2, 0.1));
  world.connect(root, bottom, 2);
  world.grab(root.id);
  const guide = world.loweringAlignment(root.id)!;
  assert.ok(guide);
  assert.equal(guide.memberId, bottom.id);
  assert.ok(
    guide.position.distanceTo(new Vector3(1, root.position.y, 0)) < 1e-4,
  );
  assert.ok(Math.abs(guide.drop - 4.2) < 1e-4);
  assert.equal(world.links.length, 1);
  world.world.free();
});

test("real sockets guide quarter turns and moving tiles, while smooth support tops do not", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  let held = world.add(
    spec("tile-2x2"),
    "#66846b",
    new Vector3(0.1, 5, 0.1),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
  );
  world.grab(held.id);
  assert.ok(
    world.loweringAlignment(held.id),
    "a tile still has bottom sockets",
  );
  world.clear();
  world.add(spec("tile-2x2"), "#df553e", new Vector3(0, 0.2, 0));
  held = world.add(spec("2x2"), "#66846b", new Vector3(0.1, 5, 0.1));
  world.grab(held.id);
  assert.equal(world.loweringAlignment(held.id), null);
  world.world.free();
});

test("guides reject yaw correction, side and underside approaches, and distant projections", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const held = world.add(
    spec("2x2"),
    "#66846b",
    new Vector3(0.1, 5, 0.1),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.02),
  );
  world.grab(held.id);
  assert.equal(
    world.loweringAlignment(held.id),
    null,
    "guide must not turn the part",
  );
  assert.ok(
    world.transform(
      held.id,
      new Vector3(0.1, 5, 0.1),
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2),
    ),
  );
  assert.equal(world.loweringAlignment(held.id), null);
  assert.ok(
    world.transform(held.id, new Vector3(0.3, 5, 0.3), new Quaternion()),
  );
  assert.equal(world.loweringAlignment(held.id), null);
  world.clear();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 3, 0));
  const below = world.add(spec("2x2"), "#66846b", new Vector3(0.1, 0.6, 0.1));
  world.grab(below.id);
  assert.equal(
    world.loweringAlignment(below.id),
    null,
    "an upward press is not a lowering guide",
  );
  world.world.free();
});

test("a smooth blocker in the lowering path prevents a false alignment guide", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  world.add(spec("tile-2x2"), "#e9b938", new Vector3(0, 4, 0));
  const held = world.add(spec("2x2"), "#66846b", new Vector3(0.1, 8, 0.1));
  world.grab(held.id);
  const before = world.serialize();
  assert.equal(world.loweringAlignment(held.id), null);
  assert.deepEqual(world.serialize(), before);
  world.world.free();
});

test("the entire held assembly must clear the lowering path", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(1, 0.6, 0));
  world.add(spec("tile-2x2"), "#e9b938", new Vector3(-2, 2, 0));
  const bridge = world.add(spec("2x4"), "#66846b", new Vector3(0, 5.2, 0));
  const foot = world.add(spec("2x2"), "#66846b", new Vector3(-2, 4, 0));
  world.connect(bridge, foot, 2);
  world.grab(bridge.id);
  assert.equal(world.loweringAlignment(bridge.id), null);
  world.world.free();
});

test("guides respect empty arch sockets and the smooth front of slopes", async () => {
  const world = await scene();
  world.add(spec("round-1x1"), "#df553e", new Vector3(0.5, 0.6, 0));
  let held = world.add(spec("arch-1x4"), "#66846b", new Vector3(0, 8, 0));
  world.grab(held.id);
  assert.equal(world.loweringAlignment(held.id), null);
  world.clear();
  world.add(spec("slope-2x2"), "#df553e", new Vector3(0, 0.6, 0));
  held = world.add(spec("round-1x1"), "#66846b", new Vector3(0.5, 8, 0.5));
  world.grab(held.id);
  assert.equal(world.loweringAlignment(held.id), null);
  assert.ok(world.transform(held.id, new Vector3(0.5, 8, -0.5)));
  assert.ok(world.loweringAlignment(held.id));
  world.world.free();
});


test("a high lowering guide becomes a snap hologram target and commits that exact lowered pose", async () => {
  const world = await scene();
  const lower = world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.04, 5, 0.04));
  world.grab(upper.id);
  assert.equal(
    world.snapCandidate(upper.id),
    null,
    "legacy nearby snap should not reach several units downward",
  );
  const guide = world.loweringAlignment(upper.id)!;
  assert.ok(guide);
  const preview = world.loweringSnapCandidate(upper.id, guide)!;
  assert.ok(preview);
  assert.equal(preview.upperId, upper.id);
  assert.equal(preview.lowerId, lower.id);
  assert.ok(
    Math.abs(preview.position.y - (guide.position.y - guide.drop)) < 1e-6,
  );
  assert.equal(world.links.length, 0);
  assert.equal(world.commitSnap(upper.id, preview), true);
  assert.equal(world.links.length, 1);
  assert.equal(world.held.size, 0);
  assert.ok(
    upper.position.distanceTo(new Vector3().copy(preview.position)) < 1e-5,
  );
  world.world.free();
});

test("a lowering snap preview is rejected if its support moves before release", async () => {
  const world = await scene();
  const lower = world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.04, 5, 0.04));
  world.grab(upper.id);
  const guide = world.loweringAlignment(upper.id)!;
  const preview = world.loweringSnapCandidate(upper.id, guide)!;
  lower.body.setTranslation({ x: 0.5, y: 0.6, z: 0 }, true);
  world.sync();
  assert.equal(world.commitSnap(upper.id, preview), false);
  assert.equal(world.links.length, 0);
  assert.equal(world.held.size, 1);
  world.world.free();
});
