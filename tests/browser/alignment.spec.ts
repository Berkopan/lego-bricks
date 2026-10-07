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

async function setSnap(page: Page, enabled: boolean) {
  const toggle = page.locator("#snap-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== String(enabled)) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", String(enabled));
}

test("Snap-off lowering alignment shows four corner projection lines and clears them when leaving", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await setSnap(page, false);
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
  await setSnap(page, false);
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


test("complex settled assembly projects before the brick enters nearby Snap range", async ({
  page,
}, info) => {
  test.setTimeout(45_000);
  await page.evaluate(async () => {
    const [{ catalog }, { Quaternion, Vector3 }] = await Promise.all([
      import("/src/engine/catalog.ts"),
      import("/node_modules/three/build/three.module.js"),
    ]);
    const find = (id: string) =>
      catalog.find((item: { id: string }) => item.id === id);
    const { world, select } = window.__bricks;
    select(null);
    world.clear();

    const drift = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      0.01,
    );
    const base = world.add(
      find("2x4"),
      "#3e7b9b",
      new Vector3(0, 0.6, 0),
      drift,
    );
    const support = world.add(
      find("2x2"),
      "#3e7b9b",
      new Vector3(1, 1.8, 0),
      drift,
    );
    const side = world.add(
      find("2x2"),
      "#3e7b9b",
      new Vector3(-1, 1.8, 0),
      drift,
    );
    const tower = world.add(
      find("2x2"),
      "#3e7b9b",
      new Vector3(-1, 3, 0),
      drift,
    );
    world.connect(support, base, 4);
    world.connect(side, base, 4);
    world.connect(tower, side, 4);

    const held = world.add(
      find("2x2"),
      "#df553e",
      new Vector3(1.04, 6, 0.04),
    );
    world.grab(held.id);
    select(held);
    window.testUpper = held;
    window.testLower = support;
  });
  await frames(page, 3);

  expect((await state(page)).ghost).toBe(false);
  await expect.poll(async () => (await state(page)).projection).toBe(true);

  await setSnap(page, true);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const current = await state(page);
  expect(current.target).not.toBeNull();
  expect(current.target![1]).toBeLessThan(current.position[1] - 2);

  const screenshot = info.outputPath("complex-high-projection.png");
  await page.screenshot({ path: screenshot });
  await info.attach("complex-high-projection", {
    path: screenshot,
    contentType: "image/png",
  });
});
