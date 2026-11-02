/**
 * Browser checks: the real page, real WASM, real WebGL.
 * Screenshots land in test-results/screenshots/ for a human to skim.
 * PROTECTED: see CLAUDE.md.
 */
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";

async function openSim(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto("./");
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, {
    timeout: 30_000,
  });
  const error = await page.evaluate(() => window.__paiSim.error);
  expect(error, "simulator failed to load").toBeNull();
  return errors;
}

test("loads, simulates and renders without errors", async ({ page }) => {
  const errors = await openSim(page);
  const t0 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => window.__paiSim.time());
  expect(t1 - t0, "sim time should advance").toBeGreaterThan(0.5);

  // Canvas is drawn and not blank.
  await expect(page.locator("#status"), "loading message must disappear").toBeHidden();
  const canvas = page.locator("#viewport canvas");
  await expect(canvas).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop.png` });
  expect(errors).toEqual([]);
});

test("rover drives forward from the drive controls", async ({ page }) => {
  await openSim(page);
  await page.waitForTimeout(500); // let things settle
  const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
  await page.evaluate(() => window.__paiSim.setDrive(1, 0));
  await page.waitForTimeout(1500);
  const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
  expect(x1 - x0).toBeGreaterThan(0.3);
  await page.screenshot({ path: `${SHOTS}/driving.png` });
});

test("keyboard drives the rover", async ({ page }) => {
  await openSim(page);
  await page.waitForTimeout(500);
  const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowUp");
  const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
  expect(x1 - x0).toBeGreaterThan(0.2);
});

test("performance budget: keeps up with real time", async ({ page }) => {
  await openSim(page);
  // Adaptive quality kicks in ~2.5 s after load; measure after it settles.
  await page.waitForTimeout(4000);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  samples.sort((a, b) => a - b);
  const median = samples[2]!;
  // Software-rendered CI browser (the worst case): require >= 80% of real time.
  expect(median, `samples: ${samples.map((s) => s.toFixed(2)).join(", ")}`).toBeGreaterThan(0.8);
});

test("works on a phone-sized screen", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await openSim(page);
  await expect(page.locator(".pad")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal scroll").toBe(false);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/mobile.png` });
  await page.close();
});
