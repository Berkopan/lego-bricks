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
