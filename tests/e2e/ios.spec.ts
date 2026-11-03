/**
 * iPhone Safari support.
 *
 * CI has no WebKit, so this covers what can be checked without one:
 * 1. The built bundle only uses syntax Safari 15 can parse. Newer syntax
 *    (class static blocks, regex lookbehind before Safari 16.4) is a
 *    SyntaxError there, and the page stays on "Loading…" forever.
 * 2. The page on an emulated iPhone (touch, 3× screen, Safari user agent):
 *    loads, fits the notch-free area, the drive pad works by touch, and form
 *    controls are big enough that iOS doesn't zoom in on them.
 * PROTECTED: see CLAUDE.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { full } from "acorn-walk";
import { devices, expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
const ASSETS = fileURLToPath(new URL("../../dist/assets/", import.meta.url));

test.describe("bundle syntax works in Safari 15", () => {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".js"));

  test("there is a built bundle to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(file.replace(/-[\w]+\.js$/, ".js"), () => {
      const code = readFileSync(ASSETS + file, "utf8");
      // ES2022 is the newest syntax Safari 15 parses (it has class fields and
      // private methods); anything newer fails to parse here.
      const ast = parse(code, { ecmaVersion: 2022, sourceType: "module" });
      const problems: string[] = [];
      full(ast, (node) => {
        if (node.type === "StaticBlock") problems.push(`class static block at ${node.start} (Safari 16.4+)`);
        const regex = (node as { regex?: { pattern: string; flags: string } }).regex;
        if (regex) {
          if (/\(\?<[=!]/.test(regex.pattern)) problems.push(`regex lookbehind /${regex.pattern}/ (Safari 16.4+)`);
          if (regex.flags.includes("v")) problems.push(`regex v flag /${regex.pattern}/ (Safari 17+)`);
        }
      });
      expect(problems).toEqual([]);
    });
  }
});

const iPhone = devices["iPhone 13"];

async function openOnIphone(page: Page): Promise<string[]> {
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

/** Press and hold a drive button the way a finger does (touch pointer events). */
async function holdButton(page: Page, selector: string, ms: number): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  const init = { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, ...at };
  await page.dispatchEvent(selector, "pointerdown", init);
  await page.waitForTimeout(ms);
  await page.dispatchEvent(selector, "pointerup", init);
}

test.describe("on an iPhone", () => {
  test.use({
    viewport: iPhone.viewport,
    deviceScaleFactor: iPhone.deviceScaleFactor,
    isMobile: iPhone.isMobile,
    hasTouch: iPhone.hasTouch,
    userAgent: iPhone.userAgent,
  });

  test("loads, fits the screen and drives by touch", async ({ page }) => {
    const errors = await openOnIphone(page);
    await expect(page.locator("#status")).toBeHidden();
    await expect(page.locator("#drive-pad")).toBeVisible();

    const layout = await page.evaluate(() => {
      const de = document.documentElement;
      const pad = document.querySelector("#drive-pad")!.getBoundingClientRect();
      const fontSize = (sel: string) => parseFloat(getComputedStyle(document.querySelector(sel)!).fontSize);
      return {
        overflowX: de.scrollWidth > de.clientWidth,
        overflowY: de.scrollHeight > de.clientHeight,
        padInside: pad.right <= innerWidth && pad.bottom <= innerHeight && pad.left >= 0,
        padButton: document.querySelector("#drive-pad button")!.getBoundingClientRect().width,
        selectFont: fontSize("#scene-picker"),
        buttonFont: fontSize("#reset"),
        viewportFit: document.querySelector('meta[name="viewport"]')!.getAttribute("content"),
      };
    });
    expect(layout.overflowX, "no sideways scrolling").toBe(false);
    expect(layout.overflowY, "no page scrolling").toBe(false);
    expect(layout.padInside, "drive pad fully on screen").toBe(true);
    // Apple's minimum comfortable touch target is 44 pt.
    expect(layout.padButton).toBeGreaterThanOrEqual(44);
    // iOS zooms the page in when a control with text under 16px gets focus.
    expect(layout.selectFont).toBeGreaterThanOrEqual(16);
    expect(layout.buttonFont).toBeGreaterThanOrEqual(16);
    expect(layout.viewportFit).toContain("viewport-fit=cover");

    await page.waitForTimeout(500);
    const [x0] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
    await holdButton(page, '#drive-pad [data-key="arrowup"]', 1500);
    const [x1] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
    expect(x1 - x0, "holding forward drives the rover").toBeGreaterThan(0.2);

    // Releasing stops it.
    await page.waitForTimeout(600);
    const [x2] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
    await page.waitForTimeout(600);
    const [x3] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
    expect(Math.abs(x3 - x2), "rover stops after release").toBeLessThan(0.05);

    await page.screenshot({ path: `${SHOTS}/iphone.png` });
    expect(errors).toEqual([]);
  });

  test("a long press on a drive button doesn't open the context menu", async ({ page }) => {
    await openOnIphone(page);
    const prevented = await page.evaluate(() => {
      const btn = document.querySelector('#drive-pad [data-key="arrowup"]')!;
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      btn.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);
    const callout = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector("#drive-pad button")!);
      return { select: s.getPropertyValue("user-select") || s.getPropertyValue("-webkit-user-select") };
    });
    expect(callout.select).toBe("none");
  });

  test("landscape iPhone keeps the pad on screen", async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: iPhone.viewport.height, height: iPhone.viewport.width },
      deviceScaleFactor: iPhone.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      userAgent: iPhone.userAgent,
    });
    const errors = await openOnIphone(page);
    await expect(page.locator("#hint")).toHaveText(/arrow pad.*pinch to zoom/);
    const inside = await page.evaluate(() => {
      const r = document.querySelector("#drive-pad")!.getBoundingClientRect();
      return r.right <= innerWidth && r.bottom <= innerHeight && r.top > 0;
    });
    expect(inside).toBe(true);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/iphone-landscape.png` });
    expect(errors).toEqual([]);
    await page.close();
  });
});
