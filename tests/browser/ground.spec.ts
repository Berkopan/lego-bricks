import { expect, test } from "@playwright/test";
import { frames, setup, state } from "./helpers";

declare global {
  interface Window {
    groundProbe: {
      steps: number;
      minY: number;
      maxPoseMismatch: number;
      buried: { step: number; id: number; minY: number }[];
      sample(): void;
    };
  }
}

test("Snap release keeps a loaded bridge above the floor in every live physics step", async ({
  page,
}, info) => {
  // Software-rendered CI needs enough wall time for all 240 live physics steps.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await setup(page);
  const mobile = info.project.name === "mobile";
  if (mobile) await expect(page.locator("html")).toHaveClass(/touch-layout/);

  const fixture = await page.evaluate(async () => {
    const catalogPath = "/src/engine/catalog.ts";
    const threePath = "/node_modules/three/build/three.module.js";
    const [{ catalog }, { Box3, Vector3 }] = await Promise.all([
      import(catalogPath),
      import(threePath),
    ]);
    const { world, select, camera, renderer } = window.__bricks;
    const rendering = {
      pixelRatio: renderer.getPixelRatio(),
      shadows: renderer.shadowMap.enabled,
    };
    // Reduce software-rendering cost while preserving geometry, the CSS
    // viewport and live physics.
    renderer.setPixelRatio(0.5);
    renderer.shadowMap.enabled = false;
    select(null);
    world.clear();
    const add = (part: string, x: number, y: number, color = "#383c43") =>
      world.add(
        catalog.find((item: { id: string }) => item.id === part),
        color,
        new Vector3(x, y + 1, 0),
      );
    // An eleven-piece bridge with two linked supports mirrors the loaded
    // assembly in the report. Start one unit above the floor, as when adding
    // a new part releases the previously held build, to exercise its landing.
    const leftBase = add("2x4", -2, 0.605);
    const rightBase = add("2x4", 2, 0.605);
    const leftPlate = add("plate-2x4", -3, 1.405);
    const rightPlate = add("plate-2x4", 1, 1.405);
    world.connect(leftPlate, leftBase, 6);
    world.connect(rightPlate, rightBase, 6);
    world.connect(rightPlate, leftBase, 2);
    const leftLower = add("2x2", -4, 2.205);
    const rightLower = add("2x2", 0, 2.205, "#3e7b9b");
    const leftUpper = add("2x2", -4, 3.405);
    const rightUpper = add("2x2", 0, 3.405, "#df553e");
    world.connect(leftLower, leftPlate, 4);
    world.connect(rightLower, rightPlate, 4);
    world.connect(leftUpper, leftLower, 4);
    world.connect(rightUpper, rightLower, 4);
    const bridge = add("2x4", -2, 4.605);
    world.connect(bridge, leftUpper, 2);
    world.connect(bridge, rightUpper, 2);
    const middle = add("2x2", -3, 5.805, "#e9b938");
    const support = add("2x2", -3, 7.005, "#66846b");
    world.connect(middle, bridge, 4);
    world.connect(support, middle, 4);
    const upper = world.add(
      support.spec,
      "#df553e",
      support.position.clone().add(new Vector3(0.04, 1.7, 0.04)),
    );
    world.grab(upper.id);
    select(upper);
    window.testUpper = upper;
    window.testLower = support;
    camera.position.set(22, 21, 28);

    const bounds = new Box3();
    const probe = {
      steps: 0,
      minY: Infinity,
      maxPoseMismatch: 0,
      buried: [] as { step: number; id: number; minY: number }[],
      sample() {
        for (const brick of world.bricks) {
          // Independent rendered-vertex oracle: the production support helper
          // and its bounds must not be used to verify themselves.
          const minY = bounds.setFromObject(brick.mesh, true).min.y;
          this.minY = Math.min(this.minY, minY);
          if (minY < -1e-5 && this.buried.length < 10)
            this.buried.push({ step: this.steps, id: brick.id, minY });
          const p = brick.body.translation();
          this.maxPoseMismatch = Math.max(
            this.maxPoseMismatch,
            Math.hypot(
              brick.mesh.position.x - p.x,
              brick.mesh.position.y - p.y,
              brick.mesh.position.z - p.z,
            ),
          );
        }
      },
    };
    window.groundProbe = probe;
    const step = world.step.bind(world);
    // Observe every completed 120 Hz substep of the real animation loop. A
    // later substep or the old delayed correction cannot hide a buried frame.
    world.step = () => {
      step();
      probe.steps++;
      probe.sample();
    };
    return { baseId: leftBase.id, baseY: leftBase.position.y, rendering };
  });
  await frames(page);
  const snap = page.locator("#snap-toggle");
  if (mobile) await snap.tap();
  else await snap.click();
  await expect(snap).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const shown = await state(page);
  expect(shown.links).toBe(11);
  expect(shown.held).toBe(1);
  expect(shown.target).not.toBeNull();

  // Both devices use their actual height controls and movement-release Snap
  // path. No fixture code commits the new joint or advances the simulation.
  if (mobile) await page.locator("[data-repeat=down]").tap();
  else await page.locator("#down").click();
  await expect
    .poll(async () => {
      const current = await state(page);
      return { links: current.links, held: current.held };
    })
    .toEqual({ links: 12, held: 0 });
  const committed = await state(page);
  committed.position.forEach((value, axis) =>
    expect(value).toBeCloseTo(shown.target![axis], 4),
  );
  await page.evaluate(() => window.groundProbe.sample());

  const pause = page.locator("#pause");
  if (mobile) await pause.tap();
  else await pause.click();
  await expect(pause).not.toHaveClass(/paused/);
  await page.waitForFunction(() => window.groundProbe.steps >= 240, undefined, {
    timeout: 40_000,
  });
  if (mobile) await pause.tap();
  else await pause.click();
  await expect(pause).toHaveClass(/paused/);

  const result = await page.evaluate((baseId) => {
    const { world } = window.__bricks;
    const { steps, minY, maxPoseMismatch, buried } = window.groundProbe;
    return {
      steps,
      minY,
      maxPoseMismatch,
      buried,
      baseY: world.get(baseId).position.y,
      pieces: world.bricks.length,
      links: world.links.length,
    };
  }, fixture.baseId);
  expect(result.steps).toBeGreaterThanOrEqual(240);
  expect(result.buried, JSON.stringify(result.buried)).toEqual([]);
  expect(result.minY).toBeGreaterThanOrEqual(-1e-5);
  expect(result.maxPoseMismatch).toBeLessThan(1e-7);
  expect(result.baseY).toBeLessThan(fixture.baseY - 0.9);
  expect(result.pieces).toBe(12);
  expect(result.links).toBe(12);
  expect(errors).toEqual([]);

  await page.evaluate(({ pixelRatio, shadows }) => {
    const { renderer } = window.__bricks;
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = shadows;
  }, fixture.rendering);
  await frames(page);
  const screenshot = info.outputPath("ground-bridge-after-snap.png");
  await page.screenshot({ path: screenshot });
  await info.attach("ground-bridge-after-snap", {
    path: screenshot,
    contentType: "image/png",
  });
});
