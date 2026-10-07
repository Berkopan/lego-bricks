import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Quaternion, Scene, Vector3 } from "three";
import { catalog } from "../src/engine/catalog";
import { component } from "../src/engine/connections";
import { BrickWorld, type Brick } from "../src/engine/world";

const groundTolerance = 1e-5;
const spec = (id: string) => catalog.find((part) => part.id === id)!;
const renderedBottom = (brick: Brick) =>
  // Precise vertex bounds avoid counting the empty corners of the local AABB
  // as visible geometry when round or sloped parts rotate.
  new Box3().setFromObject(brick.mesh, true).min.y;

function assertAboveGround(world: BrickWorld, context: string) {
  for (const brick of world.bricks) {
    const minY = renderedBottom(brick);
    assert.ok(
      minY >= -groundTolerance,
      `${context}: ${brick.spec.id} #${brick.id} crossed the floor at y=${minY}`,
    );
    assert.ok(
      brick.mesh.position.distanceTo(brick.position) < 1e-7 &&
        brick.position.distanceTo(
          new Vector3().copy(brick.body.translation()),
        ) < 1e-7,
      `${context}: rendered and physical positions must agree`,
    );
  }
}

function advance(
  world: BrickWorld,
  seconds: number,
  fps: number,
  context: string,
) {
  // The UI batches fixed 120 Hz physics steps into each rendered frame. Check
  // every substep as well, so a following step cannot hide a transient breach.
  for (let frame = 0; frame < seconds * fps; frame++)
    for (let substep = 0; substep < 120 / fps; substep++) {
      world.step();
      assertAboveGround(world, `${context}, frame ${frame}, step ${substep}`);
    }
}

function attach(
  world: BrickWorld,
  partId: string,
  support: Brick,
  offsetX = 0,
) {
  const part = spec(partId);
  const upper = world.add(
    part,
    "#66846b",
    support.position
      .clone()
      .add(
        new Vector3(
          offsetX,
          (support.spec.height + part.height) / 2 + 0.5,
          0,
        ).applyQuaternion(support.rotation),
      ),
    support.rotation.clone(),
  );
  world.grab(upper.id);
  const preview = world.snapCandidate(upper.id);
  assert.ok(preview, `part #${upper.id} must have a real snap target`);
  assert.ok(world.commitSnap(upper.id, preview));
  assert.equal(
    world.held.size,
    0,
    "snapping must return the assembly to physics",
  );
  assertAboveGround(world, `immediately after attaching part #${upper.id}`);
  return upper;
}

test("fallen rendered parts never cross the floor and still settle naturally", async (t) => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  t.after(() => world.world.free());

  const cases = catalog.flatMap((spec, index) => [
    {
      name: `${spec.id}:upright`,
      spec,
      q: new Quaternion(),
      slot: index * 2,
    },
    {
      name: `${spec.id}:tilted`,
      spec,
      q: new Quaternion().setFromEuler(new Euler(0.47, 0.31, 0.39)),
      slot: index * 2 + 1,
    },
  ]);

  const bricks = cases.map(({ spec, q, slot }) => {
    const x = (slot % 7) * 12 - 36;
    const z = Math.floor(slot / 7) * 12 - 18;
    return world.add(spec, "#df553e", new Vector3(x, 6, z), q);
  });

  for (let i = 0; i < 1800; i++) {
    world.step();
    assertAboveGround(world, `catalog drop, step ${i}`);
  }

  const diagnostics = bricks.map((brick, index) => {
    const bounds = new Box3().setFromObject(brick.mesh, true);
    const childMins = brick.mesh.children
      .map((child, childIndex) => ({
        childIndex,
        minY: new Box3().setFromObject(child, true).min.y,
      }))
      .filter(({ minY }) => minY < -groundTolerance);
    return {
      name: cases[index].name,
      minY: bounds.min.y,
      position: brick.position.toArray(),
      rotation: brick.rotation.toArray(),
      childMins,
      speed: new Vector3().copy(brick.body.linvel()).length(),
      spin: new Vector3().copy(brick.body.angvel()).length(),
    };
  });

  const unsettled = diagnostics.filter(
    ({ speed, spin }) => speed > 0.05 || spin > 0.05,
  );
  assert.deepEqual(unsettled, [], JSON.stringify(unsettled, null, 2));

  assert.ok(
    bricks.every((brick) => brick.position.y < 4),
    "floor protection must let every part fall from its initial height of 6",
  );
  const buried = diagnostics.filter(({ minY }) => minY < -groundTolerance);
  assert.deepEqual(buried, [], JSON.stringify(buried, null, 2));
});

for (const fps of [30, 60])
  test(`progressively loading a connected assembly never buries its base at ${fps} fps`, async (t) => {
    const world = new BrickWorld(new Scene(), () => {});
    await world.init();
    t.after(() => world.world.free());

    let support = world.add(
      spec("plate-2x4"),
      "#383c43",
      new Vector3(0, 0.205, 0),
    );
    advance(world, 2, fps, "settling the base");
    // Alternating one-stud offsets load the thin base asymmetrically while
    // keeping the center of mass inside its footprint. Every addition uses the
    // same snap/release API as touch and mouse controls, with no injected poses.
    for (let added = 1; added <= 10; added++) {
      support = attach(world, "2x4", support, added % 2 ? 1 : -1);
      advance(world, 3, fps, `after attaching part #${support.id}`);
    }

    assert.equal(world.bricks.length, 11);
    assert.equal(world.links.length, 10);
    assert.equal(component(support.id, world.links).size, 11);
    assert.ok(
      world.bricks.every(
        (brick) =>
          new Vector3().copy(brick.body.linvel()).length() < 0.05 &&
          new Vector3().copy(brick.body.angvel()).length() < 0.05,
      ),
      "the loaded assembly must settle without an ongoing correction bounce",
    );
  });

test("adding a new held brick cannot make a released 11-piece bridge cross the floor", async (t) => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  t.after(() => world.world.free());

  const leftBase = world.add(spec("2x4"), "#383c43", new Vector3(-2, 0.605, 0));
  const rightBase = world.add(spec("2x4"), "#383c43", new Vector3(2, 0.605, 0));
  advance(world, 2, 30, "settling the bridge bases");
  const addSettled = (partId: string, support: Brick, offsetX = 0) => {
    const upper = attach(world, partId, support, offsetX);
    advance(world, 2, 30, `building bridge part #${upper.id}`);
    return upper;
  };

  let left = addSettled("plate-2x4", leftBase, -1);
  let right = addSettled("plate-2x4", rightBase, -1);
  for (let level = 0; level < 2; level++) {
    left = addSettled("2x2", left, level === 0 ? -1 : 0);
    right = addSettled("2x2", right, level === 0 ? -1 : 0);
  }
  const bridge = addSettled("2x4", left, 2);
  const upper = addSettled("2x2", addSettled("2x2", bridge, -1));
  const assembly = component(upper.id, world.links);
  assert.equal(assembly.size, 11);
  assert.equal(
    world.links.length,
    11,
    "both sides of the bridge must be linked",
  );

  world.grab(upper.id);
  assert.ok(
    world.transform(upper.id, upper.position.clone().add(new Vector3(0, 1, 0))),
  );
  const raisedY = leftBase.position.y;
  const next = world.spawnHeld(spec("2x2"), "#e9b938", new Vector3(0, 12, 10));
  assert.ok(next);
  assert.deepEqual([...world.held], [next.id]);
  assertAboveGround(
    world,
    "immediately after the next part releases the bridge",
  );

  advance(world, 8, 30, "released bridge");
  assert.ok(
    leftBase.position.y < raisedY - 0.9,
    "the released assembly must actually fall, not be frozen in midair",
  );
  assert.equal(component(upper.id, world.links).size, 11);
  assert.ok(
    [...assembly].every(
      (id) => new Vector3().copy(world.get(id).body.linvel()).length() < 0.05,
    ),
    "the bridge must come to rest after its fall",
  );
});

test("floor protection lets a tilted linked assembly slide and rotate into rest", async (t) => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  t.after(() => world.world.free());

  const lower = world.add(
    spec("2x4"),
    "#df553e",
    new Vector3(0, 6, 0),
    new Quaternion().setFromEuler(new Euler(0.4, 0.2, 0.3)),
  );
  const middle = attach(world, "2x4", lower, 1);
  attach(world, "2x4", middle, -1);
  const center = () =>
    world.bricks
      .reduce((sum, brick) => sum.add(brick.position), new Vector3())
      .multiplyScalar(1 / world.bricks.length);
  const initialCenter = center();
  const spin = new Vector3(1.2, 0.4, -0.7);
  for (const brick of world.bricks) {
    brick.body.setAngvel(spin, true);
    // Give the connected assembly a consistent rigid-body velocity field.
    brick.body.setLinvel(
      new Vector3(2, 0, 1).add(
        spin.clone().cross(brick.position.clone().sub(initialCenter)),
      ),
      true,
    );
  }

  let contactCenter: Vector3 | undefined;
  let contactRotation: Quaternion | undefined;
  let travelAfterContact = 0;
  let rotationAfterContact = 0;
  for (let step = 0; step < 1800; step++) {
    world.step();
    assertAboveGround(world, `sliding tilted assembly, step ${step}`);
    if (
      !contactCenter &&
      Math.min(...world.bricks.map(renderedBottom)) < 0.02
    ) {
      contactCenter = center();
      contactRotation = lower.rotation.clone().normalize();
    }
    if (contactCenter) {
      const current = center();
      travelAfterContact = Math.max(
        travelAfterContact,
        Math.hypot(current.x - contactCenter.x, current.z - contactCenter.z),
      );
      rotationAfterContact = Math.max(
        rotationAfterContact,
        lower.rotation.clone().normalize().angleTo(contactRotation!),
      );
    }
  }

  assert.ok(contactCenter, "the assembly must reach the floor");
  assert.ok(center().y < initialCenter.y - 3, "gravity must remain active");
  assert.ok(
    travelAfterContact > 0.2,
    "floor contact must preserve enough horizontal motion to slide into rest",
  );
  assert.ok(
    rotationAfterContact > 0.2,
    "floor contact must allow the tilted assembly to rotate into rest",
  );
  assert.equal(component(lower.id, world.links).size, 3);
  assert.ok(
    world.bricks.every((brick) => brick.body.isSleeping()),
    "the assembly must eventually sleep without continuous correction jitter",
  );
});

test("bricks beyond the finite floor keep falling and are removed below the world", async (t) => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();
  t.after(() => world.world.free());

  const outside = [
    new Vector3(150, 3, 0),
    new Vector3(101.1, 3, 0),
    new Vector3(-101.1, 3, 0),
    new Vector3(0, 3, 101.1),
    new Vector3(0, 3, -101.1),
  ].map((position) => world.add(spec("2x2"), "#df553e", position));
  for (let step = 0; step < 120; step++) world.step();
  assert.ok(
    outside.every((brick) => brick.position.y < -1),
    "even a brick just beyond the floor edge must keep falling",
  );
  for (let step = 0; step < 240; step++) world.step();
  assert.equal(world.bricks.length, 0);
});
