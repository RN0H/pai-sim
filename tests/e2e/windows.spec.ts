/**
 * Windows + desktop Chrome/Edge support, as far as CI (Linux Chrome) can check:
 * - Windows laptops usually run at 125% / 150% display scaling, so the canvas
 *   must cope with a fractional devicePixelRatio (no blur, no overflow).
 * - Files saved on Windows have CRLF line endings, a UTF-8 BOM (Notepad), and
 *   are often reported with an empty or odd MIME type by the file picker.
 * - Windows touch laptops have both a mouse and a touch screen.
 * PROTECTED: see CLAUDE.md.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
const WINDOWS_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto("./");
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return errors;
}

for (const scale of [1.25, 1.5]) {
  test.describe(`Windows Chrome at ${scale * 100}% scaling`, () => {
    test.use({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: scale, userAgent: WINDOWS_CHROME_UA });

    test("renders sharp, fits the window and drives with the keyboard", async ({ page }) => {
      const errors = await open(page);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("#viewport canvas")!;
        const r = c.getBoundingClientRect();
        const de = document.documentElement;
        return {
          ratioW: c.width / r.width,
          ratioH: c.height / r.height,
          dpr: devicePixelRatio,
          overflow: de.scrollWidth > de.clientWidth || de.scrollHeight > de.clientHeight,
        };
      });
      expect(canvas.dpr).toBeCloseTo(scale, 5);
      // Backing store matches the scaled size (to the pixel), so it isn't blurry.
      expect(Math.abs(canvas.ratioW - Math.min(scale, 2))).toBeLessThan(0.02);
      expect(Math.abs(canvas.ratioH - Math.min(scale, 2))).toBeLessThan(0.02);
      expect(canvas.overflow).toBe(false);

      await page.waitForTimeout(500);
      const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
      await page.keyboard.down("w");
      await page.waitForTimeout(1200);
      await page.keyboard.up("w");
      const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
      expect(x1 - x0).toBeGreaterThan(0.2);
      await page.screenshot({ path: `${SHOTS}/windows-${scale * 100}.png` });
      expect(errors).toEqual([]);
    });
  });
}

test("opens a model saved on Windows (CRLF, BOM, no MIME type)", async ({ page }) => {
  await open(page);
  const unix = readFileSync(fixture("pendulum.xml"), "utf8");
  const windows = "﻿" + unix.replace(/\r?\n/g, "\r\n");
  await page.locator("#file-input").setInputFiles({ name: "pendulum.xml", mimeType: "", buffer: Buffer.from(windows, "utf8") });
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("custom");
  expect(await page.evaluate(() => window.__paiSim.modelName())).toBe("fixture pendulum");
  expect(await page.evaluate(() => window.__paiSim.loadError())).toBeNull();
});

test.describe("Windows touch laptop (mouse and touch screen)", () => {
  test.use({ hasTouch: true, userAgent: WINDOWS_CHROME_UA });

  test("the drive pad works by touch and by mouse", async ({ page }) => {
    await open(page);
    await expect(page.locator("#drive-pad")).toBeVisible();
    const up = page.locator('#drive-pad [data-key="arrowup"]');
    for (const pointerType of ["touch", "mouse"]) {
      await page.evaluate(() => window.__paiSim.reset());
      await page.waitForTimeout(300);
      const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
      const box = (await up.boundingBox())!;
      const init = { pointerType, pointerId: 3, isPrimary: true, bubbles: true, clientX: box.x + 10, clientY: box.y + 10 };
      await up.dispatchEvent("pointerdown", init);
      await page.waitForTimeout(1200);
      await up.dispatchEvent("pointerup", init);
      const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
      expect(x1 - x0, pointerType).toBeGreaterThan(0.2);
    }
  });
});
