import {
  test,
  expect,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { brickPoint, fixture, frames, setup, state } from "./helpers";

type Point = { x: number; y: number };

/** CDP sends trusted touch input through hit testing, capture and the real UI. */
class Fingers {
  private points = new Map<number, Point>();
  constructor(private session: CDPSession) {}
  private send(
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    points = this.points,
  ) {
    return this.session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: [...points].map(([id, point]) => ({
        id,
        ...point,
        radiusX: 1,
        radiusY: 1,
        force: 1,
      })),
    });
  }
  async down(id: number, point: Point) {
    this.points.set(id, point);
    await this.send("touchStart");
  }
  async move(id: number, point: Point) {
    this.points.set(id, point);
    await this.send("touchMove");
  }
  async up(id: number) {
    const point = this.points.get(id);
    if (!point) throw new Error(`Touch ${id} is not down`);
    this.points.delete(id);
    // Chromium's default WebTouchEvent path releases the supplied touchEnd IDs;
    // omitting a finger from touchMove leaves it pressed. An empty touchEnd list
    // would release every finger, hiding bugs in independent control ownership.
    await this.send("touchEnd", new Map([[id, point]]));
  }
  async close() {
    if (this.points.size) {
      this.points.clear();
      await this.send("touchCancel");
    }
    await this.session.detach();
  }
}

async function withFingers(
  page: Page,
  run: (fingers: Fingers) => Promise<void>,
) {
  const fingers = new Fingers(await page.context().newCDPSession(page));
  try {
    await run(fingers);
  } finally {
    await fingers.close();
  }
}
async function center(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box, `${selector} must be visible and hittable`).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}
async function enableSnap(page: Page) {
  await page.locator("#snap-toggle").tap();
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await frames(page);
}
async function dragTouch(page: Page, fingers: Fingers) {
  const point = await brickPoint(page);
  const before = await state(page);
  await fingers.down(1, point);
  await fingers.move(1, { x: point.x + 12, y: point.y });
  await expect
    .poll(async () => (await state(page)).position[1])
    .toBeGreaterThan(before.position[1] + 0.3);
  await frames(page);
  return { x: point.x + 12, y: point.y };
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}
async function expectConnected(
  page: Page,
  shown: Awaited<ReturnType<typeof state>>,
) {
  expect(shown.ghost).toBe(true);
  expect(shown.target).not.toBeNull();
  await expect.poll(async () => (await state(page)).links).toBe(1);
  const connected = await state(page);
  expect(connected.held).toBe(0);
  connected.position.forEach((value, i) =>
    expect(value).toBeCloseTo(shown.target![i], 4),
  );
  connected.rotation.forEach((value, i) =>
    expect(value).toBeCloseTo(shown.targetRotation![i], 4),
  );
  expect(connected.lowerPosition).toEqual(shown.lowerPosition);
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
  test.skip(
    info.project.name !== "mobile",
    "Real touch coverage runs in the coarse-pointer mobile project.",
  );
  const collected: string[] = [];
  errors.set(page, collected);
  page.on("pageerror", (error) => collected.push(error.message));
  await setup(page);
  await expect(page.locator("html")).toHaveClass(/touch-layout/);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? [], "No uncaught browser errors").toEqual([]);
});

test("mobile layout disables browser double-tap zoom while preserving app-owned touch surfaces", async ({
  page,
}) => {
  const actions = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    body: getComputedStyle(document.body).touchAction,
    canvas: getComputedStyle(document.querySelector("#world")!).touchAction,
    button: getComputedStyle(
      document.querySelector("#library-toggle")!,
    ).touchAction,
    joystick: getComputedStyle(
      document.querySelector("#brick-joystick")!,
    ).touchAction,
  }));

  expect(actions.html).toBe("manipulation");
  expect(actions.body).toBe("manipulation");
  expect(actions.button).toBe("manipulation");
  expect(actions.canvas).toBe("none");
  expect(actions.joystick).toBe("none");
});

test("mobile UI disables text selection and long-press copy surfaces", async ({
  page,
}) => {
  const selection = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).userSelect,
    body: getComputedStyle(document.body).userSelect,
    brand: getComputedStyle(document.querySelector(".brand")!).userSelect,
    library: getComputedStyle(
      document.querySelector("#library h2")!,
    ).userSelect,
    button: getComputedStyle(
      document.querySelector("#library-toggle")!,
    ).userSelect,
  }));

  expect(selection.html).toBe("none");
  expect(selection.body).toBe("none");
  expect(selection.brand).toBe("none");
  expect(selection.library).toBe("none");
  expect(selection.button).toBe("none");
});

test("touch drag with Snap off keeps the moved brick held and creates no hologram or joint", async ({
  page,
}) => {
  await expect(page.locator("#snap-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await fixture(page);
  await withFingers(page, async (fingers) => {
    await dragTouch(page, fingers);
    expect((await state(page)).ghost).toBe(false);
    await fingers.up(1);
  });
  await frames(page);
  const current = await state(page);
  expect(current.links).toBe(0);
  expect(current.held).toBe(1);
  expect(current.ghost).toBe(false);
});

for (const selection of ["same", "different"] as const) {
  test(`touch drag of a ${selection} selected brick commits the visible hologram target`, async ({
    page,
  }, info) => {
    await enableSnap(page);
    await fixture(page);
    if (selection === "different") {
      await page.evaluate(() => window.__bricks.select(window.testLower));
      await frames(page);
    }
    await withFingers(page, async (fingers) => {
      await dragTouch(page, fingers);
      const shown = await state(page);
      expect(shown.links).toBe(0);
      expect(shown.ghost).toBe(true);
      await screenshot(page, info, `snap-touch-${selection}-preview`);
      await fingers.up(1);
      await expectConnected(page, shown);
    });
  });
}

test("brick selection taps and centered joystick taps never accept an existing preview", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  const before = await state(page);
  expect(before.ghost).toBe(true);
  await withFingers(page, async (fingers) => {
    await fingers.down(1, await brickPoint(page));
    await fingers.up(1);
    await frames(page);
    await fingers.down(2, await center(page, "#brick-joystick"));
    await frames(page, 3);
    await fingers.up(2);
  });
  await frames(page);
  const after = await state(page);
  expect(after.links).toBe(0);
  expect(after.held).toBe(1);
  expect(after.position).toEqual(before.position);
  await expect(page.locator("#brick-joystick")).not.toHaveClass(/active/);
});

test("a second scene finger transfers a drag to the camera without snapping", async ({
  page,
}) => {
  await enableSnap(page);
  await fixture(page);
  await withFingers(page, async (fingers) => {
    const point = await dragTouch(page, fingers);
    const beforeCamera = await state(page);
    expect(beforeCamera.ghost).toBe(true);
    await fingers.down(2, { x: point.x + 65, y: point.y + 65 });
    await fingers.move(2, { x: point.x + 75, y: point.y + 60 });
    await fingers.up(1);
    await fingers.up(2);
    await frames(page);
    const after = await state(page);
    expect(after.links).toBe(0);
    expect(after.held).toBe(1);
    expect(after.position).toEqual(beforeCamera.position);
  });
});

test("joystick and height support both start and release orders, snapping only on the final release", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await enableSnap(page);
  for (const heightStartsFirst of [false, true])
    for (const heightEndsFirst of [false, true]) {
      await test.step(`start ${heightStartsFirst ? "height" : "stick"}; release ${heightEndsFirst ? "height" : "stick"} first`, async () => {
        await fixture(page, { y: 2.55 });
        const stick = await center(page, "#brick-joystick");
        const down = await center(page, ".hud-actions [data-repeat=down]");
        const pushed = { x: stick.x + 9, y: stick.y };
        await withFingers(page, async (fingers) => {
          if (heightStartsFirst) {
            await fingers.down(2, down);
            await fingers.down(1, pushed);
          } else {
            await fingers.down(1, pushed);
            await fingers.down(2, down);
          }
          await frames(page, 3);
          await expect(page.locator("#brick-joystick")).toHaveClass(/active/);
          const moving = await state(page);
          expect(moving.links).toBe(0);
          expect(
            Math.hypot(moving.position[0] - 0.04, moving.position[2] - 0.04),
          ).toBeGreaterThan(0.00001);
          // Keep ownership but stop horizontal travel while examining the preview.
          await fingers.move(1, stick);
          await expect
            .poll(async () => (await state(page)).position[1])
            .toBeLessThan(2.25);
          expect((await state(page)).links).toBe(0);
          if (!heightStartsFirst && heightEndsFirst)
            await screenshot(
              page,
              info,
              "snap-mobile-stick-and-height-preview",
            );
          if (heightEndsFirst) {
            await fingers.up(2);
            await expect(page.locator("#brick-joystick")).toHaveClass(/active/);
            const before = await state(page);
            await fingers.move(1, pushed);
            await frames(page, 2);
            await fingers.move(1, stick);
            const continued = await state(page);
            expect(
              Math.hypot(
                continued.position[0] - before.position[0],
                continued.position[2] - before.position[2],
              ),
            ).toBeGreaterThan(0.00001);
          } else {
            await fingers.up(1);
            await expect(page.locator("#brick-joystick")).not.toHaveClass(
              /active/,
            );
          }
          await frames(page);
          const shown = await state(page);
          expect(shown.links).toBe(0);
          expect(shown.held).toBe(1);
          expect(shown.ghost).toBe(true);
          await fingers.up(heightEndsFirst ? 1 : 2);
          await expectConnected(page, shown);
          await expect(page.locator("#brick-joystick")).not.toHaveClass(
            /active/,
          );
        });
      });
    }
});

for (const interruption of ["camera", "snap-off"] as const) {
  test(`${interruption} interrupts an active touch safely and ignores its later release`, async ({
    page,
  }) => {
    await enableSnap(page);
    await fixture(page);
    await withFingers(page, async (fingers) => {
      const stick = await center(page, "#brick-joystick");
      await fingers.down(1, { x: stick.x + 9, y: stick.y });
      await frames(page, 3);
      await fingers.move(1, stick);
      expect((await state(page)).ghost).toBe(true);
      // A real keyboard activation leaves the owning touch down, exercising the
      // mode/toggle cancellation itself before that finger eventually releases.
      await page
        .locator(
          interruption === "camera" ? "[data-mode=camera]" : "#snap-toggle",
        )
        .press("Enter");
      await expect(page.locator("#brick-joystick")).not.toHaveClass(/active/);
      if (interruption === "camera")
        await expect(page.locator("html")).toHaveAttribute(
          "data-control-mode",
          "camera",
        );
      else
        await expect(page.locator("#snap-toggle")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      const stopped = await state(page);
      await fingers.move(1, { x: stick.x + 15, y: stick.y });
      await fingers.up(1);
      await frames(page, 3);
      const after = await state(page);
      expect(after.links).toBe(0);
      expect(after.held).toBe(1);
      expect(after.position).toEqual(stopped.position);
      if (interruption === "snap-off") expect(after.ghost).toBe(false);
    });
  });
}

test("Snap and touch controls fit phone, tablet and landscape viewports without overlapping", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await fixture(page);
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await frames(page, 3);
    await expect(page.locator("#touch-toolbar > #snap-toggle")).toBeVisible();
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const bounds = document
          .querySelector(selector)!
          .getBoundingClientRect();
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      };
      const groups = [".touch-modes", "#snap-toggle", ".touch-zoom"].map(rect);
      const toggle = groups[1];
      const hit = document.elementFromPoint(
        toggle.x + toggle.width / 2,
        toggle.y + toggle.height / 2,
      );
      return {
        groups,
        header: rect("header"),
        toolbar: rect("#touch-toolbar"),
        stick: rect("#brick-joystick"),
        actions: rect(".hud-actions"),
        hitToggle: !!hit?.closest("#snap-toggle"),
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    const overlap = (a: typeof layout.header, b: typeof layout.header) =>
      Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
      Math.max(
        0,
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
      );
    for (const box of [...layout.groups, layout.stick, layout.actions]) {
      expect(box.x).toBeGreaterThanOrEqual(-0.5);
      expect(box.y).toBeGreaterThanOrEqual(-0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height + 0.5);
    }
    for (let a = 0; a < layout.groups.length; a++)
      for (let b = a + 1; b < layout.groups.length; b++)
        expect(overlap(layout.groups[a], layout.groups[b])).toBe(0);
    expect(overlap(layout.header, layout.toolbar)).toBe(0);
    expect(overlap(layout.stick, layout.actions)).toBe(0);
    expect(layout.groups[1].width).toBeGreaterThanOrEqual(44);
    expect(layout.groups[1].height).toBeGreaterThanOrEqual(44);
    expect(layout.hitToggle).toBe(true);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    await screenshot(
      page,
      info,
      `mobile-layout-${viewport.width}x${viewport.height}`,
    );
  }
});
