import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { createManualPlan, type SceneSnapshot } from "../src/manual/plan";

type SavedBrick = SceneSnapshot["bricks"][number];
const brick = (
  id: number,
  spec: string,
  p: [number, number, number],
  color = "#df553e",
  q = new Quaternion(),
): SavedBrick => ({ id, spec, p, color, q: q.toArray() });
const scene = (
  bricks: SavedBrick[],
  links: SceneSnapshot["links"] = [],
): SceneSnapshot => ({ version: 1, bricks, links });
const bridge = () =>
  scene([
    brick(7, "2x4", [0, 1.8, 0], "#383c43"),
    brick(90, "2x2", [-1, 0.6, 0]),
    brick(2, "tile-2x2", [0, 2.6, 0], "#eee6d3"),
    brick(11, "2x2", [1, 0.6, 0]),
  ]);

test("a bridge waits for both lower supports, including unsaved contacts", () => {
  const snapshot = bridge();
  // Only the left foot was explicitly connected in the source.
  snapshot.links.push({ a: 7, b: 90, studs: 4 });
  const plan = createManualPlan(snapshot);
  assert.equal(plan.assemblies.length, 1);
  assert.equal(plan.steps.length, 4);
  assert.deepEqual(
    plan.steps.map((s) => s.added[0]),
    [90, 11, 7, 2],
  );
  assert.deepEqual(new Set(plan.steps[2].supports), new Set([90, 11]));
  assert.deepEqual(plan.steps[3].supports, [7]);
  assert.deepEqual(plan.warnings, []);
  const built = new Set<number>();
  for (const step of plan.steps) {
    for (const support of step.supports) assert.ok(built.has(support));
    for (const id of step.added) {
      assert.ok(!built.has(id));
      built.add(id);
    }
    assert.deepEqual(new Set(step.built), built);
  }
  assert.deepEqual(built, new Set(snapshot.bricks.map((b) => b.id)));
});

test("a hanging short leg warns that temporary support is needed before its canopy is installed", () => {
  const plan = createManualPlan(
    scene(
      [
        brick(1, "2x2", [-1, 0.6, 0]),
        brick(2, "2x2", [-1, 1.8, 0]),
        brick(3, "2x4", [0, 3, 0]),
        brick(4, "2x2", [1, 1.8, 0]),
      ],
      [
        { a: 2, b: 1, studs: 4 },
        { a: 3, b: 2, studs: 4 },
        { a: 3, b: 4, studs: 4 },
      ],
    ),
  );
  assert.equal(plan.assemblies.length, 1);
  const order = plan.steps.map((step) => step.added[0]);
  assert.ok(order.indexOf(4) < order.indexOf(3));
  assert.deepEqual(
    plan.warnings
      .filter((warning) => warning.code === "unsupported")
      .map((warning) => warning.brickIds),
    [[4]],
  );
  assert.ok(!plan.warnings.some((warning) => warning.code === "collision"));
});

const enclosedScene = () =>
  scene([
    brick(1, "1x2", [0, 0.6, -1.5]),
    brick(2, "1x2", [0, 0.6, 1.5]),
    brick(
      3,
      "1x2",
      [-1.5, 0.6, 0],
      "#df553e",
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    ),
    brick(
      4,
      "1x2",
      [1.5, 0.6, 0],
      "#df553e",
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
    ),
    brick(5, "plate-2x4", [0, 1.4, -1]),
    brick(6, "plate-2x4", [0, 1.4, 1]),
    brick(20, "round-plate-1x1", [0, 0.2, 0], "#e9b938"),
  ]);

test("a separate enclosed component is built first and gets a world-placement access advisory", () => {
  for (const rotation of [
    new Quaternion(),
    new Quaternion().setFromAxisAngle(
      new Vector3(0.3, 0.4, 0.8).normalize(),
      0.7,
    ),
  ]) {
    const snapshot = enclosedScene();
    for (const part of snapshot.bricks) {
      part.p = new Vector3()
        .fromArray(part.p)
        .applyQuaternion(rotation)
        .add(new Vector3(5, 5, 3))
        .toArray();
      part.q = rotation
        .clone()
        .multiply(new Quaternion().fromArray(part.q))
        .toArray();
    }
    const plan = createManualPlan(snapshot);
    assert.deepEqual(
      plan.assemblies.map((assembly) => assembly.brickIds.length),
      [1, 6],
    );
    assert.deepEqual(plan.steps[0].added, [20]);
    const warning = plan.warnings.find(
      (warning) => warning.code === "assembly-access",
    );
    assert.ok(warning);
    assert.deepEqual(
      new Set(warning.brickIds),
      new Set([1, 2, 3, 4, 5, 6, 20]),
    );
    assert.ok(!plan.warnings.some((warning) => warning.code === "collision"));
  }
});

test("an open-sided enclosure does not trigger the closed-component access advisory", () => {
  const snapshot = enclosedScene();
  snapshot.bricks = snapshot.bricks.filter((part) => part.id !== 2);
  const plan = createManualPlan(snapshot);
  assert.deepEqual(
    plan.assemblies.map((assembly) => assembly.brickIds.length),
    [5, 1],
  );
  assert.ok(
    !plan.warnings.some((warning) => warning.code === "assembly-access"),
  );
});

test("inventory separates part shapes and colors while preserving exact brick color", () => {
  const snapshot = scene([
    brick(1, "1x2", [0, 0.6, 0], "#DF553E"),
    brick(2, "1x2", [3, 0.6, 0], "#df553e"),
    brick(3, "1x2", [6, 0.6, 0], "#3e7b9b"),
    brick(4, "plate-1x2", [9, 0.2, 0], "#df553e"),
  ]);
  const plan = createManualPlan(snapshot);
  assert.deepEqual(
    plan.inventory.map(({ key, count }) => ({ key, count })),
    [
      { key: "1x2:#3e7b9b", count: 1 },
      { key: "1x2:#df553e", count: 2 },
      { key: "plate-1x2:#df553e", count: 1 },
    ],
  );
  assert.equal(
    plan.inventory.reduce((count, entry) => count + entry.count, 0),
    4,
  );
  assert.equal(plan.bricks.find((b) => b.id === 1)!.color, "#DF553E");
});

test("input order, link order, and renumbered IDs do not change construction choices", () => {
  const original = bridge();
  original.links = [
    { a: 7, b: 90, studs: 4 },
    { a: 7, b: 11, studs: 4 },
  ];
  original.bricks.push(brick(6, "1x2", [8, 0.6, -3]));
  const shuffled = structuredClone(original);
  shuffled.bricks.reverse();
  for (const part of shuffled.bricks) part.id = 1000 - part.id * 3;
  shuffled.links.reverse();
  for (const link of shuffled.links) {
    link.a = 1000 - link.a * 3;
    link.b = 1000 - link.b * 3;
  }
  const describe = (snapshot: SceneSnapshot) => {
    const plan = createManualPlan(snapshot);
    return plan.steps.map((step) => ({
      assembly: step.assembly,
      added: step.added.map((id) => {
        const part = plan.bricks.find((b) => b.id === id)!;
        return {
          p: part.position.toArray(),
          spec: part.spec.id,
          color: part.color,
        };
      }),
    }));
  };
  assert.deepEqual(describe(shuffled), describe(original));
  assert.deepEqual(describe(original), describe(original));
});

test("separate models are completed coherently and each step only contains its own assembly", () => {
  const snapshot = bridge();
  snapshot.bricks.push(
    brick(60, "2x2", [8, 0.6, 0]),
    brick(4, "plate-2x4", [8, 1.4, 0]),
    brick(88, "round-1x1", [-8, 0.6, 0]),
  );
  const plan = createManualPlan(snapshot);
  assert.deepEqual(
    plan.assemblies.map((a) => a.brickIds.length),
    [4, 2, 1],
  );
  assert.deepEqual(
    plan.steps.map((s) => s.assembly),
    [1, 1, 1, 1, 2, 2, 3],
  );
  assert.deepEqual(
    plan.steps.map((s) => s.number),
    [1, 2, 3, 4, 5, 6, 7],
  );
  for (const assembly of plan.assemblies) {
    for (const step of assembly.steps)
      assert.ok(step.built.every((id) => assembly.brickIds.includes(id)));
    assert.deepEqual(
      new Set(assembly.steps.at(-1)!.built),
      new Set(assembly.brickIds),
    );
  }
});

test("tilted and inverted models use their local stud axis without rewriting source poses", () => {
  for (const rotation of [
    new Quaternion().setFromAxisAngle(
      new Vector3(0.3, 0.4, 0.8).normalize(),
      1.2,
    ),
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI),
  ]) {
    const snapshot = bridge();
    for (const part of snapshot.bricks) {
      part.p = new Vector3()
        .fromArray(part.p)
        .applyQuaternion(rotation)
        .add(new Vector3(5, 10, -4))
        .toArray();
      part.q = rotation.toArray();
    }
    const plan = createManualPlan(snapshot);
    assert.equal(plan.assemblies.length, 1);
    const assembly = plan.assemblies[0];
    assert.ok(assembly.rotation.angleTo(rotation) < 1e-7);
    const order = plan.steps.map((step) => step.added[0]);
    assert.ok(order.indexOf(90) < order.indexOf(7));
    assert.ok(order.indexOf(11) < order.indexOf(7));
    assert.ok(order.indexOf(7) < order.indexOf(2));
    for (const part of plan.bricks) {
      const source = snapshot.bricks.find((b) => b.id === part.id)!;
      assert.deepEqual(part.position.toArray(), source.p);
      assert.deepEqual(part.rotation.toArray(), source.q);
    }
    const inverse = assembly.rotation.clone().invert();
    for (const id of [90, 11]) {
      const part = plan.bricks.find((b) => b.id === id)!;
      const local = part.position
        .clone()
        .sub(assembly.origin)
        .applyQuaternion(inverse);
      assert.ok(Math.abs(local.y - 0.6) < 1e-7, "local base plane is Y=0");
    }
    assert.equal(
      plan.warnings.filter((w) => w.code === "unsupported").length,
      1,
    );
    assert.ok(!plan.warnings.some((w) => w.code === "collision"));
  }
});

test("connector inference respects smooth tiles, slope studs, and corner masks", () => {
  for (const [spec, height, x, z, connected] of [
    ["tile-2x2", 0.4, 0.5, -0.5, false],
    ["slope-2x2", 1.2, 0.5, 0.5, false],
    ["slope-2x2", 1.2, 0.5, -0.5, true],
    ["corner-plate-2x2", 0.4, 0.5, 0.5, false],
    ["corner-plate-2x2", 0.4, -0.5, 0.5, true],
  ] as const) {
    const plan = createManualPlan(
      scene([
        brick(1, spec, [0, height / 2, 0]),
        brick(2, "round-1x1", [x, height + 0.6, z]),
      ]),
    );
    assert.equal(
      plan.assemblies.length,
      connected ? 1 : 2,
      `${spec} at (${x}, ${z})`,
    );
    assert.ok(!plan.warnings.some((w) => w.code === "collision"));
  }
});

test("an arch rests on both feet and never treats its hollow underside as a socket", () => {
  const plan = createManualPlan(
    scene([
      brick(1, "round-1x1", [-1.5, 0.6, 0]),
      brick(2, "round-1x1", [1.5, 0.6, 0]),
      brick(3, "round-1x1", [0.5, 0.6, 0]),
      brick(4, "arch-1x4", [0, 1.8, 0]),
    ]),
  );
  assert.equal(plan.assemblies.length, 2);
  const archStep = plan.steps.find((s) => s.added.includes(4))!;
  assert.deepEqual(new Set(archStep.supports), new Set([1, 2]));
  assert.ok(!archStep.supports.includes(3));
  assert.ok(!plan.warnings.some((w) => w.code === "collision"));
});

test("collision diagnostics retain empty arch and corner spaces instead of filling their bounding boxes", () => {
  const plan = createManualPlan(
    scene([
      brick(1, "arch-1x4", [0, 0.6, 0]),
      brick(2, "round-plate-1x1", [0, 0.2, 0]),
      brick(3, "corner-plate-2x2", [8, 0.2, 0]),
      brick(4, "round-plate-1x1", [8.5, 0.2, 0.5]),
    ]),
  );
  assert.equal(plan.assemblies.length, 4);
  assert.deepEqual(plan.warnings, []);
});

test("actual intersections and buried parts produce explicit collision warnings", () => {
  const plan = createManualPlan(
    scene([
      brick(1, "2x2", [0, 0.6, 0]),
      brick(2, "2x2", [0.4, 0.6, 0]),
      brick(3, "2x2", [8, 0.2, 0]),
    ]),
  );
  assert.deepEqual(
    new Set(plan.warnings.find((w) => w.code === "collision")!.brickIds),
    new Set([1, 2, 3]),
  );
  assert.equal(
    plan.steps.length,
    3,
    "diagnostics do not silently remove scene parts",
  );
});

test("a hovering snap candidate remains separate and warns instead of being moved into place", () => {
  const snapshot = scene([
    brick(1, "2x2", [0, 0.6, 0]),
    brick(2, "2x2", [0, 2.0, 0]),
  ]);
  const plan = createManualPlan(snapshot);
  assert.equal(plan.assemblies.length, 2);
  assert.deepEqual(
    plan.warnings
      .filter((w) => w.code === "unsupported")
      .map((w) => w.brickIds),
    [[2]],
  );
  assert.deepEqual(
    plan.bricks.find((b) => b.id === 2)!.position.toArray(),
    [0, 2, 0],
  );
});

test("small physics contact errors retain their exact pose while false saved links are diagnosed", () => {
  const snapshot = scene(
    [
      brick(1, "2x2", [0, 0.6, 0]),
      brick(2, "2x2", [0.00003, 1.81002, -0.00001]),
      brick(3, "2x2", [8, 0.6, 0]),
    ],
    [{ a: 3, b: 1, studs: 4 }],
  );
  const plan = createManualPlan(snapshot);
  assert.equal(plan.assemblies.length, 2);
  assert.deepEqual(plan.steps.find((s) => s.added.includes(2))!.supports, [1]);
  assert.deepEqual(
    plan.bricks.find((b) => b.id === 2)!.position.toArray(),
    snapshot.bricks[1].p,
  );
  assert.deepEqual(
    new Set(plan.warnings.find((w) => w.code === "invalid-link")!.brickIds),
    new Set([1, 3]),
  );
});

test("planning does not mutate frozen snapshots and output poses do not alias source arrays", () => {
  const snapshot = bridge();
  const before = structuredClone(snapshot);
  for (const part of snapshot.bricks) {
    Object.freeze(part.p);
    Object.freeze(part.q);
    Object.freeze(part);
  }
  Object.freeze(snapshot.bricks);
  Object.freeze(snapshot.links);
  Object.freeze(snapshot);
  const plan = createManualPlan(snapshot);
  assert.deepEqual(snapshot, before);
  plan.bricks[0].position.set(100, 100, 100);
  plan.bricks[0].rotation.identity();
  assert.deepEqual(snapshot, before);
});

test("empty scenes produce an empty plan and malformed bricks fail before producing instructions", () => {
  assert.deepEqual(createManualPlan(scene([])), {
    bricks: [],
    inventory: [],
    assemblies: [],
    steps: [],
    warnings: [],
  });
  assert.throws(() =>
    createManualPlan(scene([brick(1, "unknown-part", [0, 0, 0])])),
  );
  assert.throws(() =>
    createManualPlan(
      scene([brick(1, "2x2", [0, 0.6, 0]), brick(1, "2x2", [2, 0.6, 0])]),
    ),
  );
});
