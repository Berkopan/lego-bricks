import { expect, test, type Page } from "@playwright/test";
import { brickPoint, drag, fixture, frames, setup, state } from "./helpers";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "Desktop mouse and keyboard gestures",
  );
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  await setup(page);
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});

async function enableSnap(page: Page) {
  await page.locator("#snap-toggle").click();
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function expectDisplayedCommit(
  page: Page,
  shown: Awaited<ReturnType<typeof state>>,
) {
  expect(shown.ghost).toBe(true);
  expect(shown.target).not.toBeNull();
  expect(shown.targetRotation).not.toBeNull();
  await expect
    .poll(async () => {
      const current = await state(page);
      return { links: current.links, held: current.held };
    })
    .toEqual({ links: 1, held: 0 });
  const current = await state(page);
  current.position.forEach((value, axis) =>
    expect(value).toBeCloseTo(shown.target![axis], 4),
  );
  current.rotation.forEach((value, axis) =>
    expect(value).toBeCloseTo(shown.targetRotation![axis], 4),
  );
  expect(current.lowerPosition).toEqual(shown.lowerPosition);
  await expect.poll(async () => (await state(page)).ghost).toBe(false);
}

test("Snap starts off and ordinary drag release keeps the legacy held behavior", async ({
  page,
}) => {
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await fixture(page);
  await drag(page);
  const moved = await state(page);
  expect(moved.ghost).toBe(false);
  await page.mouse.up();
  await frames(page);
  const released = await state(page);
  expect(released.links).toBe(0);
  expect(released.held).toBe(1);
  expect(released.ghost).toBe(false);
  expect(released.position).toEqual(moved.position);
});

test("normal drag release joins at the exact displayed hologram pose", async ({
  page,
}, testInfo) => {
  await enableSnap(page);
  await fixture(page);
  await drag(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const shown = await state(page);
  expect(shown.links).toBe(0);
  expect(shown.poses).toHaveLength(1);
  const screenshot = testInfo.outputPath("snap-hologram-desktop.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("snap-hologram-desktop", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.mouse.up();
  await expectDisplayedCommit(page, shown);
});

test("Snap turns a lowering projection into a final-pose hologram and drag release connects", async ({
  page,
}, testInfo) => {
  await enableSnap(page);
  await fixture(page, { y: 5, x: 0.04, z: 0.04 });
  await expect.poll(async () => (await state(page)).projection).toBe(true);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const beforeDrag = await state(page);
  expect(beforeDrag.target).not.toBeNull();
  expect(beforeDrag.target![1]).toBeLessThan(beforeDrag.position[1] - 2);

  await drag(page, 10, 0);
  await expect.poll(async () => (await state(page)).projection).toBe(true);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const shown = await state(page);
  expect(shown.target![1]).toBeLessThan(shown.position[1] - 2);

  const screenshot = testInfo.outputPath("snap-lowering-projection.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("snap-lowering-projection", {
    path: screenshot,
    contentType: "image/png",
  });

  await page.mouse.up();
  await expectDisplayedCommit(page, shown);
});

test("a lowering projection remains guide-only when Snap is off", async ({
  page,
}) => {
  await fixture(page, { y: 5, x: 0.04, z: 0.04 });
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(async () => (await state(page)).projection).toBe(true);
  expect((await state(page)).ghost).toBe(false);
  await page.locator("#grab").click();
  await frames(page);
  const released = await state(page);
  expect(released.links).toBe(0);
  expect(released.held).toBe(0);
  expect(released.ghost).toBe(false);
});

test("clicking a selected brick without moving never accepts its visible hologram", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const before = await state(page);
  const point = await brickPoint(page);
  await page.mouse.click(point.x, point.y);
  await frames(page);
  const current = await state(page);
  expect(current.links).toBe(0);
  expect(current.held).toBe(1);
  expect(current.position).toEqual(before.position);
});

test("pointer cancellation followed by mouse release does not snap", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await drag(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  await page.dispatchEvent("#world", "pointercancel", {
    pointerId: 1,
    pointerType: "mouse",
    bubbles: true,
  });
  await page.mouse.up();
  await frames(page);
  const current = await state(page);
  expect(current.links).toBe(0);
  expect(current.held).toBe(1);
});

test("moving away hides the preview and release cannot attach to an old target", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  const point = await drag(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  await page.mouse.move(point.x + 230, point.y, { steps: 14 });
  await expect.poll(async () => (await state(page)).ghost).toBe(false);
  const beforeRelease = await state(page);
  await page.mouse.up();
  await frames(page);
  const current = await state(page);
  expect(current.links).toBe(0);
  expect(current.held).toBe(1);
  expect(current.position).toEqual(beforeRelease.position);
});

for (const key of ["q", "e"]) {
  test(`${key.toUpperCase()} during a drag changes only height and waits for mouse release`, async ({
    page,
  }) => {
    await enableSnap(page);
    await fixture(page);
    await drag(page);
    const before = await state(page);
    await page.keyboard.down(key);
    await expect
      .poll(async () => (await state(page)).position[1])
      .not.toBe(before.position[1]);
    await page.keyboard.up(key);
    await frames(page);
    const shown = await state(page);
    expect(shown.links).toBe(0);
    expect(shown.held).toBe(1);
    expect(shown.position[0]).toBeCloseTo(before.position[0], 6);
    expect(shown.position[2]).toBeCloseTo(before.position[2], 6);
    expect(shown.position[1] - before.position[1]).toBeCloseTo(
      key === "q" ? -0.12 : 0.12,
      5,
    );
    await page.mouse.up();
    await expectDisplayedCommit(page, shown);
  });
}

test("releasing the mouse while Q stays down waits for the final keyboard release", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await drag(page);
  await page.keyboard.down("q");
  await frames(page);
  const shown = await state(page);
  await page.mouse.up();
  await frames(page);
  expect((await state(page)).links).toBe(0);
  expect((await state(page)).held).toBe(1);
  await page.keyboard.up("q");
  await expectDisplayedCommit(page, shown);
});

test("keyboard-only height movement commits on key release", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page, { y: 2.7 });
  await page.keyboard.down("q");
  await expect
    .poll(async () => (await state(page)).position[1])
    .toBeLessThan(2.65);
  await frames(page);
  const shown = await state(page);
  expect(shown.links).toBe(0);
  expect(shown.held).toBe(1);
  await page.keyboard.up("q");
  await expectDisplayedCommit(page, shown);
});

test("the explicit Drop button accepts the displayed target", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const shown = await state(page);
  await page.locator("#grab").click();
  await expectDisplayedCommit(page, shown);
});

test("Escape releases without accepting a visible target", async ({ page }) => {
  await enableSnap(page);
  await fixture(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  const before = await state(page);
  await page.keyboard.press("Escape");
  await frames(page);
  const current = await state(page);
  expect(current.links).toBe(0);
  expect(current.held).toBe(0);
  expect(current.ghost).toBe(false);
  expect(current.position).toEqual(before.position);
});

test("turning Snap off during a drag clears its preview and prevents release snapping", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await drag(page);
  await expect.poll(async () => (await state(page)).ghost).toBe(true);
  // Keyboard activation leaves the physical mouse button down during the toggle.
  await page.locator("#snap-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(async () => (await state(page)).ghost).toBe(false);
  await page.mouse.up();
  await frames(page);
  expect((await state(page)).links).toBe(0);
  expect((await state(page)).held).toBe(1);
});
