/**
 * M1 browser checks: bundled scenes, the scene picker, and loading a user's
 * own MJCF file (file picker and drag-and-drop), including invalid files.
 * PROTECTED: see CLAUDE.md.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SCENE_IDS = ["hello", "arm", "cartpole"];

async function openSim(page: Page, query = ""): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(`./${query}`);
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, {
    timeout: 30_000,
  });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return errors;
}

async function medianRealtime(page: Page): Promise<{ median: number; samples: number[] }> {
  await page.waitForTimeout(3500); // adaptive quality settles ~2.5 s after load
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[2]!, samples };
}

for (const id of SCENE_IDS) {
  test(`bundled scene "${id}" loads from ?scene= with no errors and keeps real time`, async ({ page }) => {
    const errors = await openSim(page, `?scene=${id}`);
    expect(await page.evaluate(() => window.__paiSim.scene())).toBe(id);
    await expect(page.locator("#scene-picker")).toHaveValue(id);
    expect(await page.evaluate(() => window.__paiSim.drawnGeoms())).toBeGreaterThan(2);
    const { median, samples } = await medianRealtime(page);
    expect(median, `samples: ${samples.map((s) => s.toFixed(2)).join(", ")}`).toBeGreaterThan(0.8);
    await page.screenshot({ path: `${SHOTS}/scene-${id}.png` });
    expect(errors).toEqual([]);
  });
}

test("drive pad only shows for scenes with left/right actuators", async ({ page }) => {
  await openSim(page);
  await expect(page.locator("#drive-pad")).toBeVisible();
  for (const id of ["arm", "cartpole"]) {
    await page.locator("#scene-picker").selectOption(id);
    await expect(page.locator("#drive-pad")).toBeHidden();
  }
  await page.locator("#scene-picker").selectOption("hello");
  await expect(page.locator("#drive-pad")).toBeVisible();
});

test("scene picker switches scenes and updates the URL", async ({ page }) => {
  const errors = await openSim(page);
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("hello");
  await page.locator("#scene-picker").selectOption("cartpole");
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("cartpole");
  expect(new URL(page.url()).searchParams.get("scene")).toBe("cartpole");
  // The new scene simulates from t = 0.
  const t0 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__paiSim.time())).toBeGreaterThan(t0);
  // Reload keeps the selected scene.
  await page.reload();
  await page.waitForFunction(() => window.__paiSim?.ready);
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("cartpole");
  expect(errors).toEqual([]);
});

test("an unknown ?scene= falls back to the default scene", async ({ page }) => {
  const errors = await openSim(page, "?scene=does-not-exist");
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("hello");
  expect(errors).toEqual([]);
});

test("opens a user's .xml through the file input", async ({ page }) => {
  const errors = await openSim(page);
  await page.locator("#file-input").setInputFiles(fixture("pendulum.xml"));
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("custom");
  expect(await page.evaluate(() => window.__paiSim.modelName())).toBe("fixture pendulum");
  await expect(page.locator("#scene-picker option:checked")).toHaveText(/fixture pendulum/);
  await expect(page.locator("#drive-pad")).toBeHidden();
  await expect(page.locator("#load-error")).toBeHidden();
  // It simulates: the pendulum swings.
  const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("link2"));
  await page.waitForTimeout(800);
  const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("link2"));
  expect(Math.abs(x1 - x0)).toBeGreaterThan(0.01);
  await page.screenshot({ path: `${SHOTS}/custom-file.png` });
  // Switching back to a bundled scene still works.
  await page.locator("#scene-picker").selectOption("arm");
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("arm");
  expect(errors).toEqual([]);
});

test("an invalid file shows a friendly error and the previous scene keeps running", async ({ page }) => {
  const errors = await openSim(page, "?scene=arm");
  await page.locator("#file-input").setInputFiles(fixture("invalid.xml"));
  const box = page.locator("#load-error");
  await expect(box).toBeVisible();
  await expect(box).toContainText("Couldn't open that model");
  await expect(box).toContainText("nope");
  await expect(box).not.toContainText("MuJoCo Error");
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("arm");
  await expect(page.locator("#scene-picker")).toHaveValue("arm");
  // Before adaptive quality kicks in, software-rendered CI runs well below
  // real time, so allow 1.5 s of wall time for 0.3 s of simulation.
  const t0 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__paiSim.time()), "previous scene keeps running").toBeGreaterThan(t0 + 0.3);
  await page.screenshot({ path: `${SHOTS}/invalid-file.png` });
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await expect(box).toBeHidden();
  expect(errors, "a bad file must not crash the page").toEqual([]);
});

test("a file that isn't MJCF at all shows an error", async ({ page }) => {
  await openSim(page);
  await page.locator("#file-input").setInputFiles({
    name: "notes.xml",
    mimeType: "text/xml",
    buffer: Buffer.from("<notes><note>hi</note></notes>"),
  });
  await expect(page.locator("#load-error")).toContainText("doesn't look like a MuJoCo model");
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("hello");
});

async function dropFile(page: Page, name: string, text: string): Promise<void> {
  const dt = await page.evaluateHandle(
    ([n, t]) => {
      const d = new DataTransfer();
      d.items.add(new File([t], n, { type: "text/xml" }));
      return d;
    },
    [name, text] as const,
  );
  await page.dispatchEvent("#viewport", "dragenter", { dataTransfer: dt });
  await expect(page.locator("#drop-overlay")).toBeVisible();
  await page.dispatchEvent("#viewport", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("#viewport", "drop", { dataTransfer: dt });
}

test("drag-and-drop opens a model file", async ({ page }) => {
  const errors = await openSim(page);
  await dropFile(page, "pendulum.xml", readFileSync(fixture("pendulum.xml"), "utf8"));
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("custom");
  await expect(page.locator("#drop-overlay")).toBeHidden();
  expect(await page.evaluate(() => window.__paiSim.modelName())).toBe("fixture pendulum");
  expect(errors).toEqual([]);
});

test("drag-and-drop of an invalid file shows an error and keeps the scene", async ({ page }) => {
  await openSim(page, "?scene=cartpole");
  await dropFile(page, "invalid.xml", readFileSync(fixture("invalid.xml"), "utf8"));
  await expect(page.locator("#load-error")).toBeVisible();
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("cartpole");
});

test("scene controls fit on a phone-sized screen", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await openSim(page, "?scene=arm");
  await expect(page.locator("#scene-picker")).toBeVisible();
  await expect(page.locator("label.file-button")).toBeVisible();
  await expect(page.locator("#reset")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal scroll").toBe(false);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/mobile-arm.png` });
  await page.close();
});
