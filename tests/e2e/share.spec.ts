/**
 * M6 browser checks: share links. A robot built and programmed through the
 * UI is shared; the link, opened in a fresh browser context, gives the same
 * spec, the same code and the same trajectory. Remixes record their parent;
 * blocks programs come back as blocks; broken links fall back to the
 * default scene with a friendly message. Test hooks only read state.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
/** Physics steps of the robot's path compared between the two pages. */
const STEPS = 600;

const CODE = `// 🤖 Zoomy's program: ünïcödé ✓ "quotes" \\ backslash
function loop() {
  robot.setWheels(0.6, 0.3); // 曲がる — curve right
}
`;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("dialog", (d) => void d.accept());
  return errors;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
}

/** A page in a context of its own (no shared storage or cache state with the others). */
async function freshPage(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:4173/pai-sim/", viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  return { page, errors: watchErrors(page), close: () => ctx.close() };
}

const builder = (page: Page) => page.getByRole("complementary", { name: "Build your robot" });
const codePanel = (page: Page) => page.getByRole("complementary", { name: "Program your robot" });
const editor = (page: Page) => codePanel(page).getByRole("textbox", { name: "Program" });
const shareButton = (page: Page) => page.getByRole("button", { name: "Share", exact: true });
const shareDialog = (page: Page) => page.getByRole("dialog", { name: "Share this sim" });
const remixBar = (page: Page) => page.getByRole("region", { name: "Remix" });
const spec = (page: Page) => page.evaluate(() => window.__paiSim.builderSpec());
const program = (page: Page) => page.evaluate(() => window.__paiSim.program());

/** Press Share and read the link it shows. */
async function share(page: Page): Promise<string> {
  await shareButton(page).click();
  await expect(shareDialog(page)).toBeVisible();
  const field = shareDialog(page).getByRole("textbox", { name: "Link" });
  await expect(field).toHaveValue(/#s=1[A-Za-z0-9_-]+$/);
  await expect(shareDialog(page).getByRole("status")).toContainText(/copied|copy it/);
  return field.inputValue();
}

/** The sim's path (robot position + all of qpos) for the first STEPS physics steps of the program. */
async function runAndTrace(page: Page, run: () => Promise<void>): Promise<number[][]> {
  await run();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("running");
  await expect
    .poll(() => page.evaluate(() => window.__paiSim.programTrace().length), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(STEPS);
  const prog = await program(page);
  expect(prog.state, `program failed: ${prog.error}`).toBe("running");
  return (await page.evaluate(() => window.__paiSim.programTrace())).slice(0, STEPS);
}

test.describe("share links", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("a shared link restores the same robot, code, environment and trajectory", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const errors = watchErrors(page);
    await open(page, "./");

    // Build a robot by hand.
    await page.getByRole("button", { name: "Build", exact: true }).click();
    await builder(page).getByRole("radio", { name: /Small chassis/ }).click();
    await builder(page).getByRole("radio", { name: /Large wheels/ }).click();
    await builder(page).getByRole("radio", { name: /Strong motors/ }).click();
    await builder(page).getByRole("checkbox", { name: /Distance sensor/ }).check();
    await builder(page).getByRole("textbox", { name: "Name" }).fill("Zoomy ✨");
    await builder(page).getByRole("textbox", { name: "Name" }).press("Enter");
    await expect.poll(() => spec(page)).toMatchObject({ name: "Zoomy ✨", chassis: "chassis_small", wheels: "wheel_large", motor: "motor_strong" });
    await page.getByLabel("Environment").selectOption({ label: "Sumo ring" });
    await expect.poll(() => page.evaluate(() => window.__paiSim.env())).toBe("sumo");

    // Write a program and run it.
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await editor(page).fill(CODE);
    const traceA = await runAndTrace(page, () => codePanel(page).getByRole("button", { name: "Run" }).click());

    const link = await share(page);
    expect(link.length).toBeLessThan(2000);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await page.screenshot({ path: `${SHOTS}/share-dialog.png` });
    const specA = await spec(page);

    // Open it somewhere else entirely.
    const b = await freshPage(browser);
    await open(b.page, link);
    expect(await b.page.evaluate(() => window.__paiSim.scene())).toBe("build");
    expect(await b.page.evaluate(() => window.__paiSim.env())).toBe("sumo");
    expect(await spec(b.page)).toEqual(specA);
    await expect(b.page.locator("#scene-picker option:checked")).toHaveText("My robot: Zoomy ✨");
    await expect(remixBar(b.page)).toContainText("Remixed from “Zoomy ✨”");
    await expect(remixBar(b.page)).toContainText("editing your own copy");
    await expect(remixBar(b.page).getByRole("link", { name: "“Zoomy ✨”" })).toHaveAttribute("href", link);
    await b.page.screenshot({ path: `${SHOTS}/share-opened.png` });
    await b.page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(editor(b.page)).toHaveValue(CODE);
    await expect(codePanel(b.page).getByLabel("Language")).toHaveValue("javascript");

    // Same program, same robot, same world: the same path, step for step.
    const traceB = await runAndTrace(b.page, () => remixBar(b.page).getByRole("button", { name: "Run its program" }).click());
    expect(traceB.length).toBe(STEPS);
    expect(traceB).toEqual(traceA);
    // And it really moved (the comparison isn't of two robots standing still).
    const [, x0, y0] = traceA[0]!;
    const [, x1, y1] = traceA[STEPS - 1]!;
    expect(Math.hypot(x1! - x0!, y1! - y0!)).toBeGreaterThan(0.1);

    expect(errors).toEqual([]);
    expect(b.errors).toEqual([]);
    await b.close();
  });

  test("a remix links back to the robot it came from", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page, "./?env=line");
    const original = await share(page);
    const originalSpec = await spec(page);

    // Someone opens it and changes the robot: their link is a remix.
    const b = await freshPage(browser, { permissions: ["clipboard-read", "clipboard-write"] });
    await open(b.page, original);
    await b.page.getByRole("button", { name: "Build", exact: true }).click();
    await builder(b.page).getByRole("textbox", { name: "Name" }).fill("Remixy");
    await builder(b.page).getByRole("textbox", { name: "Name" }).press("Enter");
    await expect.poll(() => spec(b.page)).toMatchObject({ name: "Remixy" });
    const remix = await share(b.page);
    expect(remix).not.toBe(original);
    await expect(shareDialog(b.page)).toContainText(`remixed from “${originalSpec.name}”`);
    // Sharing again without changes gives the same link.
    await shareDialog(b.page).getByRole("button", { name: "Close sharing" }).click();
    await expect(shareDialog(b.page)).toBeHidden();
    await expect(shareButton(b.page)).toBeFocused();
    expect(await share(b.page)).toBe(remix);

    // Opening the remix says where it came from, and that link opens the original.
    const c = await freshPage(browser);
    await open(c.page, remix);
    expect(await spec(c.page)).toMatchObject({ name: "Remixy" });
    await expect(remixBar(c.page)).toContainText("Remixed from “Remixy”");
    await expect(remixBar(c.page)).toContainText(`It was itself remixed from “${originalSpec.name}”`);
    const parentHref = await remixBar(c.page).getByRole("link", { name: `“${originalSpec.name}”` }).getAttribute("href");
    await c.page.screenshot({ path: `${SHOTS}/share-remix.png` });
    const d = await freshPage(browser);
    await open(d.page, parentHref!);
    expect(await spec(d.page)).toEqual(originalSpec);
    expect(await d.page.evaluate(() => window.__paiSim.env())).toBe("line");

    expect(errors).toEqual([]);
    for (const p of [b, c, d]) expect(p.errors).toEqual([]);
    for (const p of [b, c, d]) await p.close();
  });

  test("a blocks program comes back as blocks", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page, "./?scene=sensors");
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await codePanel(page).getByRole("button", { name: "Blocks", exact: true }).click();
    await expect(codePanel(page).getByRole("button", { name: "Blocks", exact: true })).toHaveAttribute("aria-pressed", "true");
    await codePanel(page).getByLabel("Examples").selectOption({ label: "Follow a line" });
    await expect(codePanel(page).locator(".c-status")).toContainText("as blocks");
    const link = await share(page);
    expect(link.length).toBeLessThan(2000);
    await codePanel(page).getByRole("button", { name: "Code", exact: true }).click();
    const codeA = await editor(page).inputValue();
    expect(codeA).toContain("robot.read");
    expect(errors).toEqual([]);
    await page.goto("about:blank"); // one sim at a time keeps the run below in real time

    const b = await freshPage(browser);
    await open(b.page, link);
    expect(await b.page.evaluate(() => window.__paiSim.scene())).toBe("sensors");
    await b.page.getByRole("button", { name: "Code", exact: true }).click();
    // The link's blocks open in the Blocks view.
    await expect(codePanel(b.page).getByRole("button", { name: "Blocks", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(b.page.locator(".c-blocks .blocklyDraggable").first()).toBeVisible();
    await b.page.screenshot({ path: `${SHOTS}/share-blocks.png` });
    // Shared again unchanged, it's the same link (not a remix of itself).
    expect(await share(b.page)).toBe(link);
    await shareDialog(b.page).getByRole("button", { name: "Close sharing" }).click();
    await codePanel(b.page).getByRole("button", { name: "Code", exact: true }).click();
    await expect(editor(b.page)).toHaveValue(codeA);
    // It runs and follows the line.
    await codePanel(b.page).getByRole("button", { name: "Run" }).click();
    await expect.poll(() => program(b.page).then((p) => p.time), { timeout: 20_000 }).toBeGreaterThan(2);
    expect((await program(b.page)).state).toBe("running");
    expect(b.errors).toEqual([]);
    await b.close();
  });

  test("“Run its program” on a blocks link shows and runs the blocks", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page, "./?scene=sensors");
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await codePanel(page).getByRole("button", { name: "Blocks", exact: true }).click();
    await codePanel(page).getByLabel("Examples").selectOption({ label: "Drive in a square" });
    await expect(codePanel(page).locator(".c-status")).toContainText("as blocks");
    const link = await share(page);
    expect(errors).toEqual([]);
    await page.goto("about:blank");

    const b = await freshPage(browser);
    await open(b.page, link);
    await remixBar(b.page).getByRole("button", { name: "Run its program" }).click();
    await expect(codePanel(b.page)).toBeVisible();
    await expect(codePanel(b.page).getByRole("button", { name: "Blocks", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect.poll(() => program(b.page).then((p) => p.state), { timeout: 15_000 }).toBe("running");
    await expect.poll(() => program(b.page).then((p) => p.wheels.left), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(b.errors).toEqual([]);
    await b.close();
  });

  test("a Python program comes back as Python", async ({ page, browser }) => {
    const errors = watchErrors(page);
    await open(page, "./?env=line");
    await page.getByRole("button", { name: "Code", exact: true }).click();
    await codePanel(page).getByLabel("Language").selectOption("python");
    const py = "# Python ✓ ünïcode\ndef loop():\n    robot.set_wheels(0.3, 0.3)\n";
    await editor(page).fill(py);
    const link = await share(page);

    const b = await freshPage(browser);
    await open(b.page, link);
    await b.page.getByRole("button", { name: "Code", exact: true }).click();
    await expect(codePanel(b.page).getByLabel("Language")).toHaveValue("python");
    await expect(editor(b.page)).toHaveValue(py);
    expect(errors).toEqual([]);
    expect(b.errors).toEqual([]);
    await b.close();
  });

  test("after changing a shared sim, a reload keeps the change (not the link)", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, "./?env=line");
    const link = await share(page);
    await open(page, link);
    await page.getByLabel("Environment").selectOption({ label: "Maze" });
    await expect.poll(() => page.evaluate(() => window.__paiSim.env())).toBe("maze");
    expect(new URL(page.url()).hash).toBe("");
    await page.reload();
    await page.waitForFunction(() => window.__paiSim?.ready, null, { timeout: 30_000 });
    expect(await page.evaluate(() => window.__paiSim.env())).toBe("maze");
    await expect(remixBar(page)).toBeHidden();
    // The remix bar's Dismiss leaves focus somewhere sensible.
    await open(page, link);
    await remixBar(page).getByRole("button", { name: "Dismiss the remix note" }).click();
    await expect(remixBar(page)).toBeHidden();
    await expect(shareButton(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("a model opened from a file can't be shared, and says so", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, "./");
    await page.locator("#file-input").setInputFiles("tests/e2e/fixtures/pendulum.xml");
    await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("custom");
    await shareButton(page).click();
    await expect(shareDialog(page)).toContainText("can't go in a link");
    await expect(shareDialog(page).getByRole("textbox", { name: "Link" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(shareDialog(page)).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test.describe("broken links", () => {
  for (const [what, hash] of [
    ["garbage", "#s=1notareal_link"],
    ["cut short", null],
    ["unknown format", "#s=9abc"],
  ] as const) {
    test(`a ${what} link shows a friendly error and the default scene`, async ({ page }) => {
      const errors = watchErrors(page);
      let fragment: string | null = hash;
      if (fragment === null) {
        // A real link with its end cut off, as when a chat app truncates it.
        await open(page, "./?env=maze");
        const link = await share(page);
        fragment = new URL(link).hash.slice(0, 40);
      }
      await open(page, `./${fragment}`);
      const box = page.getByRole("alert").filter({ hasText: "Couldn't open that link" });
      await expect(box).toBeVisible();
      await expect(box).toContainText(/broken|incomplete/);
      await expect(box).toContainText("Showing the default scene instead");
      expect(await page.evaluate(() => window.__paiSim.scene())).toBe("hello");
      await expect(remixBar(page)).toBeHidden();
      // The sim runs.
      const t0 = await page.evaluate(() => window.__paiSim.time());
      await expect.poll(() => page.evaluate(() => window.__paiSim.time())).toBeGreaterThan(t0 + 0.5);
      if (what === "garbage") await page.screenshot({ path: `${SHOTS}/share-broken.png` });
      expect(errors).toEqual([]);
    });
  }

  test("pasting a link into an open tab opens it", async ({ page, browser }) => {
    const errors = watchErrors(page);
    const a = await freshPage(browser);
    await open(a.page, "./?env=sumo");
    const link = await share(a.page);
    await open(page, "./");
    expect(await page.evaluate(() => window.__paiSim.scene())).toBe("hello");
    // Only the fragment changes: the browser doesn't reload by itself.
    await page.evaluate((h) => (location.hash = h), new URL(link).hash);
    // The page reloads: poll through it.
    await expect
      .poll(
        () => page.evaluate(() => (window.__paiSim?.ready ? window.__paiSim.env() : null)).catch(() => null),
        { timeout: 30_000 },
      )
      .toBe("sumo");
    expect(errors).toEqual([]);
    await a.close();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("Share fits in the header and the dialog fits the screen", async ({ page }) => {
    const errors = watchErrors(page);
    await open(page, "./?env=line");
    const brand = (await page.locator(".brand").boundingBox())!;
    const shareBox = (await shareButton(page).boundingBox())!;
    expect(Math.abs(shareBox.y - brand.y)).toBeLessThan(20);
    expect(shareBox.width).toBeGreaterThanOrEqual(32); // a usable touch target
    // Linux CI renders with DejaVu Sans, which is wider than most fonts: it must fit there too.
    const style = await page.addStyleTag({ content: ':root, button, select { font-family: "DejaVu Sans" !important; }' });
    const brandDv = (await page.locator(".brand").boundingBox())!;
    const resetDv = (await page.getByRole("button", { name: "Reset" }).boundingBox())!;
    expect(Math.abs(resetDv.y - brandDv.y)).toBeLessThan(20);
    await style.evaluate((el) => (el as Element).remove());
    await shareButton(page).tap();
    await expect(shareDialog(page)).toBeVisible();
    await expect(shareDialog(page).getByRole("textbox", { name: "Link" })).toHaveValue(/#s=/);
    const box = (await shareDialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${SHOTS}/share-phone.png` });
    expect(errors).toEqual([]);
  });
});
