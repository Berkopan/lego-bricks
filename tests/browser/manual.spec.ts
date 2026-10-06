import { readFile } from "node:fs/promises";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { frames, setup } from "./helpers";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on("pageerror", (error) => collected.push(error.message));
  await setup(page);
  await page.locator('[data-lang="en"]').click();
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page) ?? [], "No uncaught browser errors").toEqual([]);
});

async function activate(page: Page, info: TestInfo, selector: string) {
  if (info.project.name === "mobile") await page.locator(selector).tap();
  else await page.locator(selector).click();
}

/** A connected model with repeated inventory items and a separate rotated part. */
async function model(page: Page, copies = 1) {
  await page.evaluate(async (count) => {
    const catalogPath = "/src/engine/catalog.ts";
    const threePath = "/node_modules/three/build/three.module.js";
    const [{ catalog }, { Quaternion, Vector3 }] = await Promise.all([
      import(catalogPath),
      import(threePath),
    ]);
    const { world, select } = window.__bricks;
    select(null);
    world.clear();
    const parts = [
      { spec: "plate-2x4", color: "#3e7b9b", p: [0, 0.2, 0], angle: 0 },
      { spec: "2x2", color: "#df553e", p: [-1, 1, 0], angle: 0 },
      { spec: "2x2", color: "#df553e", p: [1, 1, 0], angle: 0 },
      { spec: "tile-2x2", color: "#eee6d3", p: [-1, 1.8, 0], angle: 0 },
      { spec: "slope-2x2", color: "#e9b938", p: [1, 2.2, 0], angle: Math.PI },
      { spec: "round-1x1", color: "#383c43", p: [7, 0.6, 0], angle: 0.36 },
    ];
    for (let copy = 0; copy < count; copy++)
      for (const part of parts) {
        const position = new Vector3(...part.p);
        position.z += copy * 5;
        world.add(
          catalog.find((item: { id: string }) => item.id === part.spec),
          part.color,
          position,
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), part.angle),
        );
      }
    const last = world.bricks.at(-1)!;
    world.grab(last.id);
    select(last);
  }, copies);
  await frames(page);
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    scene: window.__bricks.world.serialize(),
    held: [...window.__bricks.world.held],
  }));
}

test("downloads a real illustrated PDF and preserves every scene pose and held piece", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await model(page);
  const before = await snapshot(page);
  expect(before.scene.bricks).toHaveLength(6);
  if (info.project.name === "mobile")
    await activate(page, info, '[data-lang="tr"]');
  await expect(page.locator("#manual")).toHaveAccessibleName(
    info.project.name === "mobile" ? "Manual’i indir" : "Download manual",
  );

  const pending = page.waitForEvent("download", { timeout: 120_000 });
  await activate(page, info, "#manual");
  await expect(page.locator("#manual-progress")).toBeVisible();
  await expect(page.locator("#manual")).toBeDisabled();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  expect(await download.failure()).toBeNull();
  const path = info.outputPath("building-manual.pdf");
  await download.saveAs(path);
  await info.attach("building-manual", {
    path,
    contentType: "application/pdf",
  });

  const bytes = await readFile(path);
  const pdf = bytes.toString("latin1");
  expect(pdf.slice(0, 8)).toMatch(/^%PDF-1\./);
  expect(pdf.trimEnd()).toMatch(/%%EOF$/);
  // Inspect the generated file, not the UI's claimed page count. jsPDF keeps
  // page dictionaries outside compressed drawing/image streams.
  expect([...pdf.matchAll(/\/Type\s*\/Page\b/g)].length).toBeGreaterThan(2);
  expect([...pdf.matchAll(/\/Subtype\s*\/Image\b/g)].length).toBeGreaterThan(2);
  expect(bytes.byteLength).toBeGreaterThan(20_000);

  await expect(page.locator("#manual")).toBeEnabled();
  await expect(page.locator("#manual-download")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator("#pause")).toHaveClass(/paused/);
  await activate(page, info, "#manual-close");
  await expect(page.locator("#manual-progress")).toBeHidden();

  const saved = page.waitForEvent("download");
  await activate(page, info, "#save");
  const sceneFile = await saved;
  expect(sceneFile.suggestedFilename()).toBe("my-bricks.json");
  const scenePath = info.outputPath("scene-after-manual.json");
  await sceneFile.saveAs(scenePath);
  expect(JSON.parse(await readFile(scenePath, "utf8"))).toEqual(before.scene);
});

test("cancelling a manual stops its download and allows a fresh export", async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await model(page, 5);
  const before = await snapshot(page);
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  if (info.project.name === "desktop")
    await page.locator("#manual").press("Space");
  else await activate(page, info, "#manual");
  await expect(page.locator("#manual-progress")).toBeVisible();
  await expect(page.locator("#manual")).toBeDisabled();
  if (info.project.name === "desktop") {
    await expect(page.locator("#manual-cancel")).toBeFocused();
    await page.locator("#manual-cancel").press("Space");
  } else await activate(page, info, "#manual-cancel");
  await expect(page.locator("#manual-progress")).toBeHidden();
  await expect(page.locator("#manual")).toBeEnabled();
  if (info.project.name === "desktop")
    await expect(page.locator("#manual")).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
  expect(downloads).toEqual([]);

  // Export another, smaller snapshot immediately. A cancelled job must neither
  // overwrite this progress nor download a stale model after the retry finishes.
  await model(page);
  await page.evaluate(() => {
    const { world, select } = window.__bricks;
    select(null);
    for (const brick of [...world.bricks].slice(1)) world.remove(brick.id);
  });
  const retryScene = await snapshot(page);
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  if (info.project.name === "desktop")
    await page.locator("#manual").press("Space");
  else await activate(page, info, "#manual");
  const download = await pending;
  expect(await download.failure()).toBeNull();
  await expect(page.locator("#manual-download")).toBeVisible();
  await expect(page.locator("#manual")).toBeEnabled();
  expect(await snapshot(page)).toEqual(retryScene);
  expect(downloads).toHaveLength(1);
});

test("an empty world gives useful feedback and the translated export stays reachable", async ({
  page,
}, info) => {
  await page.evaluate(() => {
    window.__bricks.select(null);
    window.__bricks.world.clear();
  });
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await activate(page, info, "#manual");
  await expect(page.locator("#toast")).toContainText(/(brick|piece)/i);
  await expect(page.locator("#manual-progress")).toBeHidden();
  await expect(page.locator("#manual")).toBeEnabled();
  expect(downloads).toEqual([]);

  await activate(page, info, '[data-lang="tr"]');
  await expect(page.locator("#manual")).toHaveAccessibleName(/Manual.*indir/);
  const viewports =
    info.project.name === "mobile"
      ? [
          { width: 360, height: 800 },
          { width: 844, height: 390 },
        ]
      : [{ width: 1280, height: 900 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await frames(page);
    const bounds = await page.locator("#manual").boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.locator("#manual").evaluate((button) => {
        const box = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
    if (info.project.name === "mobile") {
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
    }
    await activate(page, info, "#manual");
    await expect(page.locator("#manual-progress")).toBeHidden();
  }
});
