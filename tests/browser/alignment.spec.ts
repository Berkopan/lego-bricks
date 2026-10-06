import { test, expect, type Page } from "@playwright/test";
import { drag, fixture, frames, setup, state } from "./helpers";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Desktop projection visual coverage");
  const collected: string[] = [];
  errors.set(page, collected);
  page.on("pageerror", (error) => collected.push(error.message));
  await setup(page);
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? [], "No uncaught browser errors").toEqual([]);
});

test("Snap-off lowering alignment shows four corner projection lines and clears them when leaving", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await fixture(page, { y: 5, x: 0.04, z: 0.04 });
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(async () => (await state(page)).projection).toBe(true);
  const aligned = await state(page);
  expect(aligned.projectionPoints).toHaveLength(8);
  expect(aligned.label).not.toBe("");

  const screenshot = info.outputPath("alignment-projection-desktop.png");
  await page.screenshot({ path: screenshot });
  await info.attach("alignment-projection-desktop", {
    path: screenshot,
    contentType: "image/png",
  });

  const point = await drag(page);
  await page.mouse.move(point.x + 260, point.y, { steps: 18 });
  await expect.poll(async () => (await state(page)).projection).toBe(false);
  await page.mouse.up();
  await frames(page);
  expect((await state(page)).links).toBe(0);
});


test("connected held and stationary assemblies render projection guides for the whole held component", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await page.evaluate(async () => {
    const [{ catalog }, { Vector3 }] = await Promise.all([
      import("/src/engine/catalog.ts"),
      import("/node_modules/three/build/three.module.js"),
    ]);
    const part = catalog.find((item: { id: string }) => item.id === "2x2");
    const { world, select } = window.__bricks;
    select(null);
    world.clear();

    const stationaryBase = world.add(
      part,
      "#3e7b9b",
      new Vector3(0, 0.6, 0),
    );
    const stationaryTop = world.add(
      part,
      "#3e7b9b",
      new Vector3(0, 1.8, 0),
    );
    world.connect(stationaryTop, stationaryBase, 4);

    const heldBottom = world.add(
      part,
      "#df553e",
      new Vector3(0.04, 5, 0.04),
    );
    const heldTop = world.add(
      part,
      "#df553e",
      new Vector3(0.04, 6.2, 0.04),
    );
    world.connect(heldTop, heldBottom, 4);
    world.grab(heldTop.id);
    select(heldTop);
    window.testUpper = heldTop;
    window.testLower = stationaryTop;
  });
  await frames(page, 3);

  await expect.poll(async () => (await state(page)).projection).toBe(true);
  const current = await state(page);
  expect(current.held).toBe(2);
  expect(current.projectionPoints).toHaveLength(16);
  expect(current.ghost).toBe(false);

  const screenshot = info.outputPath("assembly-alignment-projection.png");
  await page.screenshot({ path: screenshot });
  await info.attach("assembly-alignment-projection", {
    path: screenshot,
    contentType: "image/png",
  });
});
