import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3 } from "three";
import {
  planarResistance,
  moveWithAlignment,
} from "../src/engine/alignment-motion";
import { catalog } from "../src/engine/catalog";
import { BrickWorld } from "../src/engine/world";

test("horizontal alignment creates a strong detent while leaving height and free movement exact", () => {
  const position = new Vector3(0, 6, 0),
    delta = new Vector3(0.12, 0.24, -0.08);
  assert.deepEqual(planarResistance(position, delta, null), delta);
  assert.deepEqual(
    planarResistance(position, delta, new Vector3(2, 6, 0)),
    delta,
  );
  const resisted = planarResistance(position, delta, position);
  assert(resisted.x > 0 && resisted.x <= delta.x * 0.11);
  assert(resisted.z < 0 && resisted.z >= delta.z * 0.11);
  assert.equal(resisted.y, delta.y);

  const edge = planarResistance(
    new Vector3(0.2, 6, 0),
    new Vector3(0.12, 0.24, 0),
    new Vector3(0, 6, 0),
  );
  assert(edge.x > resisted.x && edge.x < 0.12);
  assert.equal(edge.y, 0.24);
});

test("crossing an alignment lands on its planar center before resisting movement away", () => {
  const alignment = new Vector3(0, 6, 0);
  const crossing = planarResistance(
    new Vector3(-0.08, 6, 0),
    new Vector3(0.16, 0.2, 0.01),
    alignment,
  );
  assert.ok(Math.abs(crossing.x - 0.08) < 1e-12);
  assert.ok(Math.abs(crossing.z) < 1e-12);
  assert.equal(crossing.y, 0.2);

  const leaving = planarResistance(
    alignment,
    new Vector3(0.12, -0.3, 0),
    alignment,
  );
  assert(leaving.x <= 0.0121);
  assert.equal(leaving.y, -0.3);
});

test("absolute-pointer resistance has no stationary-pointer creep and can be overcome", () => {
  const brick = { position: new Vector3(0, 6, 0) };
  const world = {
    get: () => brick,
    loweringAlignment: () =>
      Math.abs(brick.position.x) <= 0.17
        ? {
            position: new Vector3(0, 6, 0),
            lowerId: 2,
            memberId: 1,
            drop: 4,
          }
        : null,
    transform: (_id: number, p: Vector3) => {
      brick.position.copy(p);
      return true;
    },
  } as unknown as BrickWorld;
  const pointer = new Vector3(0.12, 6, 0);
  const result = moveWithAlignment(world, 1, pointer);
  assert(result.aligned);
  assert(result.alignment);
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
  assert(
    brick.position.x > 1.5,
    "continued movement breaks out of the alignment detent",
  );
  assert.equal(brick.position.y, 6);
});


test("blocked planar movement auto-lifts only as much as needed to clear the obstacle", () => {
  const brick = { position: new Vector3(0, 6, 0) };
  const world = {
    get: () => brick,
    loweringAlignment: () => null,
    transform: (_id: number, p: Vector3) => {
      // Horizontal motion is blocked below y=6.8, while vertical lifting itself
      // remains clear. This models rubbing against the side of another brick.
      if (Math.abs(p.x) > 0.05 && p.y < 6.8 - 1e-9) return false;
      brick.position.copy(p);
      return true;
    },
  } as unknown as BrickWorld;

  const result = moveWithAlignment(world, 1, new Vector3(0.12, 6, 0));
  assert.equal(result.blocked, false);
  assert.equal(result.lifted, true);
  assert.ok(brick.position.x > 0.05);
  assert.ok(brick.position.y >= 6.8 - 1e-9);
  assert.ok(brick.position.y < 7, "lift remains close to the minimum clearance");
});

test("free planar movement never changes height", () => {
  const brick = { position: new Vector3(0, 6, 0) };
  const world = {
    get: () => brick,
    loweringAlignment: () => null,
    transform: (_id: number, p: Vector3) => {
      brick.position.copy(p);
      return true;
    },
  } as unknown as BrickWorld;

  const result = moveWithAlignment(world, 1, new Vector3(0.3, 6, 0));
  assert.equal(result.blocked, false);
  assert.equal(result.lifted, false);
  assert.equal(brick.position.y, 6);
});


test("real collision geometry auto-lifts a dragged brick over a side obstacle", async () => {
  const createScene = async () => {
    const world = new BrickWorld(new Scene(), () => {});
    await world.init();
    world.add(catalog[1], "#3e7b9b", new Vector3(0, 0.6, 0));
    const held = world.add(
      catalog[1],
      "#df553e",
      new Vector3(-2.1, 0.6, 0),
    );
    world.grab(held.id);
    return { world, held };
  };

  const direct = await createScene();
  assert.equal(
    direct.world.transform(direct.held.id, new Vector3(-1.97, 0.6, 0)),
    true,
    "a free approach step stays at the original height",
  );
  assert.equal(
    direct.world.transform(direct.held.id, new Vector3(-1.82, 0.6, 0)),
    false,
    "the same-height side contact is blocked",
  );
  assert.equal(
    direct.world.transform(direct.held.id, new Vector3(-1.97, 2, 0)),
    true,
    "vertical clearance is available beside the obstacle",
  );
  assert.equal(
    direct.world.transform(direct.held.id, new Vector3(-1.82, 2, 0)),
    true,
    "the blocked horizontal step clears after lifting",
  );
  direct.world.world.free();

  const assisted = await createScene();
  const result = moveWithAlignment(
    assisted.world,
    assisted.held.id,
    new Vector3(-1.7, 0.6, 0),
  );

  assert.equal(
    result.blocked,
    false,
    `auto-lift should clear the side contact; position=${assisted.held.position.toArray().join(",")}`,
  );
  assert.equal(result.lifted, true);
  assert.ok(assisted.held.position.y > 1.6, "brick climbs above the obstacle");
  assert.ok(
    assisted.held.position.x > -1.9,
    "horizontal drag keeps progressing",
  );
  assisted.world.world.free();
});


test("held kinematic colliders do not push stationary bricks while editing", async () => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  const lower = world.add(catalog[1], "#3e7b9b", new Vector3(0, 2, 0));
  for (let i = 0; i < 360; i++) world.step();
  const resting = lower.position.clone();

  const held = world.add(
    catalog[1],
    "#df553e",
    new Vector3(-2.1, resting.y, resting.z),
  );
  world.grab(held.id);
  assert.equal(
    world.transform(
      held.id,
      new Vector3(-1.95, held.position.y, held.position.z),
    ),
    true,
    "clearance model allows the close pass",
  );

  for (let i = 0; i < 60; i++) world.step();
  assert.ok(
    lower.position.distanceTo(resting) < 1e-3,
    `stationary brick moved during held contact: ${lower.position.toArray().join(",")}`,
  );

  world.release();
  assert.equal(held.body.collider(0).isSensor(), false);
  world.world.free();
});

test("auto-lift produces a snap that remains valid through the next physics step", async () => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  const lower = world.add(catalog[1], "#3e7b9b", new Vector3(0, 2, 0));
  for (let i = 0; i < 360; i++) world.step();

  const held = world.add(
    catalog[1],
    "#df553e",
    new Vector3(-2.1, lower.position.y, lower.position.z),
  );
  world.grab(held.id);
  const moved = moveWithAlignment(
    world,
    held.id,
    new Vector3(-1.4, held.position.y, held.position.z),
  );
  assert.equal(moved.blocked, false);
  assert.equal(moved.lifted, true);

  const preview =
    (moved.alignment
      ? world.loweringSnapCandidate(held.id, moved.alignment)
      : null) ?? world.snapCandidate(held.id);
  assert.ok(preview, "auto-lift should immediately expose a snap target");

  world.step();
  assert.equal(
    world.commitSnap(held.id, preview!),
    true,
    "the displayed snap must survive the following solver step",
  );
  assert.equal(world.links.length, 1);
  assert.ok(
    lower.position.distanceTo(new Vector3(0, lower.position.y, lower.position.z)) <
      1e-3,
  );
  world.world.free();
});
