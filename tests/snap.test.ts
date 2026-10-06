import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Scene, Vector3 } from "three";
import { catalog } from "../src/engine/catalog";
import { component, mating } from "../src/engine/connections";
import { BrickWorld, type SnapCandidate } from "../src/engine/world";

const spec = (id: string) => catalog.find((part) => part.id === id)!;
async function scene() {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  return world;
}
function near(actual: Vector3, expected: { x: number; y: number; z: number }) {
  assert.ok(actual.distanceTo(new Vector3().copy(expected)) < 1e-4);
}

test("snap is opt-in, previews immutable exact poses, and leaves legacy press unchanged", async () => {
  const world = await scene();
  const lower = world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.4, 2.65, 0.4));
  world.grab(upper.id);
  const before = world.serialize();
  assert.equal(world.candidate(upper.id), null);
  assert.equal(world.press(upper.id), false);
  const preview = world.snapCandidate(upper.id)!;
  assert.ok(preview);
  assert.ok(Object.isFrozen(preview));
  assert.ok(Object.isFrozen(preview.poses));
  assert.ok(Object.isFrozen(preview.poses[0].position));
  assert.ok(Object.isFrozen(preview.rotation));
  assert.deepEqual(
    world.serialize(),
    before,
    "neither preview nor old press changes the scene",
  );
  assert.equal(preview.stationaryId, lower.id);
  near(new Vector3().copy(preview.position), new Vector3(0, 1.8, 0));
  assert.ok(world.commitSnap(upper.id, preview));
  near(upper.position, preview.position);
  assert.equal(world.links.length, 1);
  assert.equal(world.held.size, 0);
  assert.equal(
    world.commitSnap(upper.id, preview),
    false,
    "a release cannot be committed twice",
  );
  world.world.free();
});

test("the displayed target survives a small final pointer move before release", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.35, 2.5, 0.2));
  world.grab(upper.id);
  const preview = world.snapCandidate(upper.id)!;
  assert.ok(world.transform(upper.id, new Vector3(0.37, 2.5, 0.2)));
  assert.ok(world.commitSnap(upper.id, preview));
  near(upper.position, preview.position);
  world.world.free();
});

test("release never substitutes a newly nearby target for a stale hologram", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const other = world.add(spec("2x2"), "#df553e", new Vector3(4, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.2, 2.5, 0));
  world.grab(upper.id);
  const preview = world.snapCandidate(upper.id)!;
  assert.ok(world.transform(upper.id, new Vector3(4.2, 2.5, 0)));
  assert.equal(world.snapCandidate(upper.id)?.stationaryId, other.id);
  const before = world.serialize();
  assert.equal(world.commitSnap(upper.id, preview), false);
  assert.deepEqual(world.serialize(), before);
  assert.equal(world.held.size, 1);
  world.world.free();
});

test("moved anchors, regrabs and unissued snapshots fail atomically", async () => {
  const world = await scene();
  const lower = world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.2, 2.5, 0));
  world.grab(upper.id);
  const preview = world.snapCandidate(upper.id)!;
  assert.equal(
    world.commitSnap(upper.id, { ...preview } as SnapCandidate),
    false,
  );
  lower.body.setTranslation(new Vector3(0.03, 0.6, 0), true);
  world.sync();
  let before = world.serialize();
  assert.equal(world.commitSnap(upper.id, preview), false);
  assert.deepEqual(world.serialize(), before);
  const replacement = world.snapCandidate(upper.id)!;
  world.grab(upper.id);
  before = world.serialize();
  assert.equal(world.commitSnap(upper.id, replacement), false);
  assert.deepEqual(world.serialize(), before);
  world.world.free();
});

test("a blocker introduced after preview prevents every movement and link", async () => {
  const world = await scene();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  const upper = world.add(spec("2x2"), "#66846b", new Vector3(0.4, 2.65, 0.4));
  world.grab(upper.id);
  const preview = world.snapCandidate(upper.id)!;
  world.add(spec("tile-2x2"), "#e9b938", new Vector3(0, 1.5, 0));
  const before = world.serialize();
  assert.equal(world.commitSnap(upper.id, preview), false);
  assert.deepEqual(world.serialize(), before);
  assert.equal(world.snapCandidate(upper.id), null);
  world.world.free();
});

test("snap from below moves the held studs upward while the sockets stay fixed", async () => {
  const world = await scene();
  const upper = world.add(spec("2x2"), "#df553e", new Vector3(0, 3, 0));
  const lower = world.add(spec("2x2"), "#66846b", new Vector3(0.4, 0.95, 0.4));
  world.grab(lower.id);
  const before = upper.position.clone();
  const preview = world.snapCandidate(lower.id)!;
  assert.equal(preview.lowerId, lower.id);
  assert.ok(preview.position.y > lower.position.y);
  assert.ok(world.commitSnap(lower.id, preview));
  near(upper.position, before);
  near(lower.position, preview.position);
  assert.ok(mating(upper, lower, 0.06));
  world.world.free();
});

test("an off-center selected member previews and moves its entire rigid assembly", async () => {
  const world = await scene();
  const support = world.add(spec("2x4"), "#df553e", new Vector3(0, 0.6, 0));
  const bottom = world.add(spec("2x2"), "#66846b", new Vector3(0.4, 2.65, 0.4));
  const top = world.add(spec("2x2"), "#66846b", new Vector3(1.4, 3.85, 0.4));
  world.connect(top, bottom, 2);
  world.grab(top.id);
  const preview = world.snapCandidate(top.id)!;
  assert.equal(preview.upperId, bottom.id);
  assert.equal(preview.stationaryId, support.id);
  assert.equal(preview.poses.length, 2);
  assert.ok(world.commitSnap(top.id, preview));
  for (const pose of preview.poses)
    near(world.get(pose.id).position, pose.position);
  near(top.position.clone().sub(bottom.position), new Vector3(1, 1.2, 0));
  assert.equal(component(top.id, world.links).size, 3);
  world.world.free();
});

test("snap connects every real support under a wide bridge", async () => {
  const world = await scene();
  const left = world.add(spec("2x2"), "#df553e", new Vector3(-1, 0.6, 0));
  const right = world.add(spec("2x2"), "#df553e", new Vector3(1, 0.6, 0));
  const top = world.add(spec("2x4"), "#66846b", new Vector3(0.4, 2.65, 0.4));
  world.grab(top.id);
  assert.ok(world.commitSnap(top.id, world.snapCandidate(top.id)!));
  assert.equal(world.links.length, 2);
  assert.ok(world.links.some((link) => link.b === left.id));
  assert.ok(world.links.some((link) => link.b === right.id));
  world.world.free();
});

test("snap rejects smooth supports, absent sockets, excessive rotation and distance", async () => {
  const world = await scene();
  world.add(spec("tile-2x2"), "#df553e", new Vector3(0, 0.2, 0));
  let held = world.add(spec("2x2"), "#66846b", new Vector3(0, 1.3, 0));
  world.grab(held.id);
  assert.equal(world.snapCandidate(held.id), null);
  world.clear();
  world.add(spec("arch-1x4"), "#df553e", new Vector3(0, 2.2, 0));
  held = world.add(spec("round-1x1"), "#66846b", new Vector3(0.5, 0.7, 0));
  world.grab(held.id);
  assert.equal(world.snapCandidate(held.id), null);
  world.clear();
  world.add(spec("2x2"), "#df553e", new Vector3(0, 0.6, 0));
  held = world.add(
    spec("2x2"),
    "#66846b",
    new Vector3(0, 2.5, 0),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3),
  );
  world.grab(held.id);
  assert.equal(world.snapCandidate(held.id), null);
  assert.ok(world.transform(held.id, new Vector3(0, 4, 0), new Quaternion()));
  assert.equal(world.snapCandidate(held.id), null);
  world.world.free();
});
