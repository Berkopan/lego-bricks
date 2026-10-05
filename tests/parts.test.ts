import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, Quaternion } from "three";
import { catalog, connectors } from "../src/engine/catalog";
import { mating } from "../src/engine/connections";
import { BrickWorld } from "../src/engine/world";
const spec = (id: string) => catalog.find((s) => s.id === id)!;

test("ten new catalog parts have working bottom sockets, exact engagement and scene round trips", async () => {
  assert.equal(catalog.length, 13);
  assert.equal(new Set(catalog.map((s) => s.id)).size, 13);
  for (const s of catalog.slice(3)) {
    const w = new BrickWorld(new Scene(), () => {});
    await w.init();
    const lower = w.add(catalog[2], "#df553e", new Vector3(0, 0.6, 0));
    const upper = w.add(
      s,
      "#66846b",
      new Vector3(
        s.cols % 2 ? 0.5 : 0,
        1.2 + s.height / 2 + 0.3,
        s.rows % 2 ? 0.5 : 0,
      ),
    );
    assert.ok(connectors(s, "bottom").length, s.id);
    w.grab(upper.id);
    assert.ok(w.candidate(upper.id), s.id + " preview");
    assert.ok(w.press(upper.id), s.id + " press");
    assert.ok(
      Math.abs(upper.position.y - (1.2 + s.height / 2)) < 1e-5,
      s.id + " height",
    );
    for (let i = 0; i < 120; i++) w.step();
    assert.ok(upper.position.y > 1, s.id + " physics");
    w.restore(w.serialize());
    assert.equal(w.bricks[1].spec.id, s.id);
    assert.equal(w.links.length, 1);
    assert.ok(w.detach(w.links[0], w.bricks[1].id), s.id + " detach");
    w.world.free();
  }
});

test("tiles, slopes, corners and arches only expose actual attachment sites", () => {
  const pose = (id: number, s: ReturnType<typeof spec>, p: Vector3) => ({
    id,
    spec: s,
    position: p,
    rotation: new Quaternion(),
  });
  for (const id of ["tile-1x2", "tile-2x2", "cheese-1x1"]) {
    assert.equal(connectors(spec(id)).length, 0);
    const lower = pose(1, spec(id), new Vector3(0, spec(id).height / 2, 0));
    const upper = pose(
      2,
      spec("round-1x1"),
      new Vector3(0, spec(id).height + 0.6, 0),
    );
    assert.equal(mating(upper, lower), null);
  }
  assert.equal(connectors(spec("slope-2x2")).length, 2);
  assert.ok(connectors(spec("slope-2x2")).every((p) => p.z < 0));
  assert.equal(connectors(spec("corner-plate-2x2")).length, 3);
  assert.equal(connectors(spec("arch-1x4"), "bottom").length, 2);
  const arch = pose(2, spec("arch-1x4"), new Vector3(0, 1.8, 0));
  assert.equal(
    mating(arch, pose(1, spec("round-1x1"), new Vector3(0.5, 0.6, 0))),
    null,
    "no socket under arch opening",
  );
});

test("a small plate passes through an arch opening but cannot pass through a leg", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  const arch = w.add(spec("arch-1x4"), "#df553e", new Vector3(0, 0.6, 0));
  const part = w.add(
    spec("round-plate-1x1"),
    "#66846b",
    new Vector3(0, 0.2, 2),
  );
  w.grab(part.id);
  assert.ok(
    w.transform(part.id, new Vector3(0, 0.2, -2)),
    "opening is empty during drag",
  );
  assert.ok(w.transform(part.id, new Vector3(1.5, 0.2, -2)));
  assert.equal(
    w.transform(part.id, new Vector3(1.5, 0.2, 2)),
    false,
    "leg blocks drag",
  );
  // The dynamic compound colliders also leave the tunnel empty.
  assert.ok(w.transform(part.id, new Vector3(0, 0.2, -2)));
  assert.ok(w.transform(part.id, new Vector3(0, 0.2, 0)));
  w.release();
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(
    Math.abs(part.position.x) < 0.1,
    JSON.stringify({ part: part.position, arch: arch.position }),
  );
  assert.ok(Math.abs(part.position.z) < 0.1);
  assert.ok(arch.position.y > 0.5);
  w.world.free();
});

test("a missing corner is empty during manual positioning and simulation", async () => {
  const w = new BrickWorld(new Scene(), () => {});
  await w.init();
  w.add(spec("corner-plate-2x2"), "#df553e", new Vector3(0, 0.2, 0));
  const part = w.add(
    spec("round-plate-1x1"),
    "#66846b",
    new Vector3(0.5, 0.2, 2),
  );
  w.grab(part.id);
  assert.ok(w.transform(part.id, new Vector3(0.5, 0.2, 0.5)));
  assert.equal(w.transform(part.id, new Vector3(-0.5, 0.2, 0.5)), false);
  w.release();
  for (let i = 0; i < 120; i++) w.step();
  assert.ok(part.position.distanceTo(new Vector3(0.5, 0.2, 0.5)) < 0.1);
  w.world.free();
});

test("single round stud/socket connections are not restricted to quarter turns", () => {
  const lower = {
    id: 1,
    spec: spec("round-1x1"),
    position: new Vector3(0, 0.6, 0),
    rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.36),
  };
  const upper = {
    id: 2,
    spec: spec("round-plate-1x1"),
    position: new Vector3(0, 1.6, 0),
    rotation: new Quaternion(),
  };
  assert.equal(mating(upper, lower)?.count, 1);
});

test("arch seam markers never bridge the empty opening", async () => {
  const { seamSegments } = await import("../src/engine/seams");
  const lower = {
    id: 1,
    spec: catalog[2],
    position: new Vector3(0, 0.6, 0),
    rotation: new Quaternion(),
  };
  const upper = {
    id: 2,
    spec: spec("arch-1x4"),
    position: new Vector3(0, 1.8, 0.5),
    rotation: new Quaternion(),
  };
  const segments = seamSegments(upper, lower);
  assert.equal(segments.length, 16);
  for (let i = 0; i < segments.length; i += 2)
    assert.ok(Math.abs((segments[i].x + segments[i + 1].x) / 2) >= 1);
});
