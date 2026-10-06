import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("mobile stylesheet disables Safari long-press text callouts", () => {
  const css = readFileSync(
    new URL("../src/mobile.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /html\.touch-layout,[\s\S]*?\.touch-layout body \*[\s\S]*?user-select:\s*none;/);
  assert.match(css, /-webkit-user-select:\s*none;/);
  assert.match(css, /-webkit-touch-callout:\s*none;/);
});
