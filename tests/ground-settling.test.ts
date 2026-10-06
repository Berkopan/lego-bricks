import { test } from "node:test";
import assert from "node:assert/strict";
import { Box3, Euler, Quaternion, Scene, Vector3 } from "three";
import { catalog } from "../src/engine/catalog";
import { BrickWorld } from "../src/engine/world";

test("fallen rendered parts settle on or above the visible ground plane", async () => {
  const world = new BrickWorld(new Scene(), () => {});
  await world.init();

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

  for (let i = 0; i < 1800; i++) world.step();

  const diagnostics = bricks.map((brick, index) => {
    const bounds = new Box3().setFromObject(brick.mesh);
    const childMins = brick.mesh.children
      .map((child, childIndex) => ({
        childIndex,
        minY: new Box3().setFromObject(child).min.y,
      }))
      .filter(({ minY }) => minY < -0.003);
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

  const buried = diagnostics.filter(({ minY }) => minY < -0.003);
  assert.deepEqual(buried, [], JSON.stringify(buried, null, 2));
  world.world.free();
});
