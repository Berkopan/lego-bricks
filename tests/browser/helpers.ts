import { expect, type Page } from "@playwright/test";
import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { Brick, BrickWorld } from "../../src/engine/world";

declare global {
  interface Window {
    __bricks: {
      world: BrickWorld;
      select: (brick: Brick | null) => void;
      scene: Scene;
      camera: PerspectiveCamera;
      renderer: WebGLRenderer;
    };
    testUpper: Brick;
    testLower: Brick;
  }
}

/** Let the app render a bounded number of frames without timing-dependent sleeps. */
export async function frames(page: Page, count = 2) {
  await page.evaluate(
    (remaining) =>
      new Promise<void>((resolve) => {
        const next = () => {
          if (--remaining <= 0) resolve();
          else requestAnimationFrame(next);
        };
        requestAnimationFrame(next);
      }),
    count,
  );
}

export async function setup(page: Page) {
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden({ timeout: 30_000 });
  await page.waitForFunction(() => !!window.__bricks?.world.world);
  if (
    !(await page
      .locator("#pause")
      .evaluate((button) => button.classList.contains("paused")))
  )
    await page.locator("#pause").click();
  await expect(page.locator("#pause")).toHaveClass(/paused/);
  if (
    (await page.locator("#library-toggle").getAttribute("aria-expanded")) ===
    "true"
  )
    await page.locator("#library-toggle").click();
  await expect(page.locator("#library-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await frames(page);
}

/** Only scene construction uses the dev hook; gestures run through the real UI. */
export async function fixture(
  page: Page,
  { y = 2.15, x = 0.04, z = 0.04 }: { y?: number; x?: number; z?: number } = {},
) {
  const ids = await page.evaluate(
    async (position) => {
      const catalogPath = "/src/engine/catalog.ts";
      const threePath = "/node_modules/three/build/three.module.js";
      const [{ catalog }, { Vector3 }] = await Promise.all([
        import(catalogPath),
        import(threePath),
      ]);
      const { world, select } = window.__bricks;
      select(null);
      world.clear();
      const part = catalog.find((item: { id: string }) => item.id === "2x2");
      const lower = world.add(part, "#3e7b9b", new Vector3(0, 0.6, 0));
      const upper = world.add(
        part,
        "#df553e",
        new Vector3(position.x, position.y, position.z),
      );
      world.grab(upper.id);
      select(upper);
      window.testUpper = upper;
      window.testLower = lower;
      return { upperId: upper.id, lowerId: lower.id };
    },
    { y, x, z },
  );
  await frames(page);
  await expect
    .poll(async () => {
      const current = await state(page);
      return {
        links: current.links,
        held: current.held,
        upperId: current.upperId,
      };
    })
    .toEqual({ links: 0, held: 1, upperId: ids.upperId });
  return ids;
}

/** Inspect rendered hologram poses and public scene state, never candidate internals. */
export async function state(page: Page) {
  return page.evaluate(() => {
    const { world, scene } = window.__bricks;
    const upper = window.testUpper;
    const lower = window.testLower;
    const ghost = scene.getObjectByName("snap-preview");
    const visible = !!ghost?.visible;
    const projection = scene.getObjectByName("alignment-projection") as any;
    const projectionAttribute = projection?.geometry?.getAttribute("position");
    const target = visible
      ? ghost?.getObjectByName(`snap-preview-brick-${upper.id}`)
      : undefined;
    return {
      links: world.links.length,
      held: world.held.size,
      upperId: upper.id,
      lowerId: lower.id,
      position: upper.position.toArray(),
      rotation: upper.rotation.toArray(),
      lowerPosition: lower.position.toArray(),
      ghost: visible,
      target: target?.position.toArray() ?? null,
      targetRotation: target?.quaternion.toArray() ?? null,
      poses: visible
        ? (ghost?.children ?? []).map((member) => ({
            id: Number(member.name.replace("snap-preview-brick-", "")),
            position: member.position.toArray(),
            rotation: member.quaternion.toArray(),
          }))
        : [],
      label: document.querySelector("#alignment")?.textContent ?? "",
      projection: !!projection?.visible,
      projectionPoints: projection?.visible && projectionAttribute
        ? Array.from({ length: projectionAttribute.count }, (_, index) => [
            projectionAttribute.getX(index),
            projectionAttribute.getY(index),
            projectionAttribute.getZ(index),
          ])
        : [],
    };
  });
}

/** Screen position on a brick's visible top surface; defaults to the held fixture brick. */
export async function brickPoint(page: Page, id?: number) {
  return page.evaluate((brickId) => {
    const { world, camera, renderer } = window.__bricks;
    const brick = brickId === undefined ? window.testUpper : world.get(brickId);
    const point = brick.position.clone();
    point.y += brick.spec.height / 2;
    point.project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    return {
      x: bounds.left + ((point.x + 1) * bounds.width) / 2,
      y: bounds.top + ((1 - point.y) * bounds.height) / 2,
    };
  }, id);
}

/** Begin an actual mouse drag and leave its button pressed for release-order tests. */
export async function drag(page: Page, dx = 10, dy = 0) {
  const point = await brickPoint(page);
  const before = await state(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 3 });
  await expect
    .poll(async () => {
      const current = await state(page);
      return Math.hypot(
        current.position[0] - before.position[0],
        current.position[2] - before.position[2],
      );
    })
    .toBeGreaterThan(0.001);
  const moved = await state(page);
  expect(moved.position[1]).toBeCloseTo(before.position[1], 5);
  await frames(page);
  return point;
}
