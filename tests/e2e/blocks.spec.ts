/**
 * M4 browser checks for the Blocks view of the code panel: Blockly loads
 * only when it's opened (and nothing comes from other sites), blocks are
 * edited and run through the UI, the Code view shows the program the
 * blocks make, and it works by touch on a phone. Test hooks only read state.
 */
import { expect, test, type Page, type Request } from "@playwright/test";

const SHOTS = "test-results/screenshots";
/** Inner half-size of the Sensor playground's pen (src/scenes/sensors.ts). */
const PEN_HALF = 1.5;
/** Farthest any part of the Sensor bot reaches from its centre, rounded up. */
const ROBOT_REACH = 0.15;
const LINE_RADIUS = 0.8;
/** Blockly is fetched and started on first use: allow for a slow machine. */
const BLOCKLY_LOAD_MS = 20_000;

async function openSim(page: Page, query = "?scene=sensors"): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("request", (r: Request) => requests.push(r.url()));
  await page.goto(`./${query}`);
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return { errors, requests };
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Program your robot" });
const editor = (page: Page) => panel(page).getByRole("textbox", { name: "Program" });
/** The Blocks view: Blockly's toolbox, flyout and workspace. */
const workspace = (page: Page) => panel(page).locator(".c-blocks");
const viewButton = (page: Page, name: "Blocks" | "Code") => panel(page).getByRole("button", { name, exact: true });
const program = (page: Page) => page.evaluate(() => window.__paiSim.program());
const rover = (page: Page) => page.evaluate(() => window.__paiSim.bodyPos("rover"));
/** A block on the main workspace (not in the toolbox's flyout), by its text. */
const block = (page: Page, text: string) =>
  workspace(page).locator(".blocklyWorkspace > .blocklyBlockCanvas .blocklyDraggable").filter({ hasText: text }).last();

async function openBlocks(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await viewButton(page, "Blocks").click();
  await expect(workspace(page)).toBeVisible();
  await expect(workspace(page).locator(".blocklySvg").first()).toBeVisible({ timeout: BLOCKLY_LOAD_MS });
  await expect(viewButton(page, "Blocks")).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toBeHidden();
}

test("Blockly loads only when the Blocks view opens, from this site only", async ({ page }) => {
  const { errors, requests } = await openSim(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  // The code view is the default and Blockly isn't downloaded yet.
  await expect(viewButton(page, "Code")).toHaveAttribute("aria-pressed", "true");
  await expect(editor(page)).toBeVisible();
  expect(requests.filter((u) => /blocksEditor/.test(u))).toEqual([]);

  await viewButton(page, "Blocks").click();
  await expect(workspace(page).locator(".blocklySvg").first()).toBeVisible({ timeout: BLOCKLY_LOAD_MS });
  expect(requests.filter((u) => /blocksEditor/.test(u))).toHaveLength(1);
  // The starter blocks: every tick, set wheels 0.5 / 0.5.
  await expect(block(page, "every tick")).toBeVisible();
  await expect(block(page, "set wheels left")).toBeVisible();
  // Category toolbox is there.
  for (const cat of ["Robot", "Logic", "Loops", "Math", "Variables", "Text"]) {
    await expect(workspace(page).getByText(cat, { exact: true }).first()).toBeVisible();
  }
  await page.waitForTimeout(500); // images (sprites, cursors) load lazily
  const origin = new URL(page.url()).origin;
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"))).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/blocks-desktop.png` });
  expect(errors).toEqual([]);
});

test("edit a block, run it, and see the code the blocks make", async ({ page }) => {
  const { errors } = await openSim(page);
  await openBlocks(page);

  // Change the left wheel's 0.5 to -0.5 by clicking the number and typing.
  const setWheels = block(page, "set wheels left");
  await setWheels.locator(".blocklyEditableField").first().click();
  const field = page.locator(".blocklyWidgetDiv input");
  await expect(field).toBeVisible();
  const before = await rover(page);
  await field.press("ArrowUp"); // arrow keys inside a block's field don't drive
  await page.waitForTimeout(300);
  const after = await rover(page);
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.01);
  await field.fill("-0.5");
  await field.press("Enter");
  await expect(field).toBeHidden();

  // A block dropped outside "every tick" is greyed out and doesn't run.
  await workspace(page).locator(".blocklyToolboxCategory").filter({ hasText: "Robot" }).first().click();
  const flyoutStop = workspace(page).locator(".blocklyFlyout .blocklyDraggable").filter({ hasText: "stop wheels" }).first();
  await expect(flyoutStop).toBeVisible();
  const from = (await flyoutStop.boundingBox())!;
  const ws = (await workspace(page).boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 40, { steps: 5 });
  await page.mouse.move(ws.x + ws.width - 120, ws.y + ws.height - 60, { steps: 10 });
  await page.mouse.up();
  const loose = block(page, "stop wheels");
  await expect(loose).toBeVisible();
  await expect(loose).toHaveClass(/blocklyDisabled/);

  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => program(page).then((p) => p.wheels)).toEqual({ left: -0.5, right: 0.5 });
  await page.waitForTimeout(1000);
  expect((await program(page)).wheels).toEqual({ left: -0.5, right: 0.5 }); // the loose stop never ran

  // The Code view shows the generated program.
  await viewButton(page, "Code").click();
  await expect(editor(page)).toBeVisible();
  await expect(workspace(page)).toBeHidden();
  await expect(editor(page)).toHaveValue(/Made from your blocks/);
  await expect(editor(page)).toHaveValue(/function loop\(\) \{\n {2}robot\.setWheels\(-0\.5, 0\.5\);\n\}/);
  await expect(editor(page)).not.toHaveValue(/setWheels\(0, 0\)/);
  await page.screenshot({ path: `${SHOTS}/blocks-code-view.png` });
  expect(errors).toEqual([]);
});

test("avoid example as blocks doesn't hit a wall in 10 s and keeps real time", async ({ page }) => {
  test.setTimeout(90_000);
  const { errors } = await openSim(page);
  await openBlocks(page);
  await panel(page).getByLabel("Examples").selectOption({ label: "Avoid obstacles" });
  await expect(block(page, "when the program starts")).toBeVisible();
  await expect(block(page, "distance ahead")).toBeVisible();
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("running");
  await page.screenshot({ path: `${SHOTS}/blocks-example.png` });

  const realtime: number[] = [];
  const samples: [number, number, number][] = [];
  for (;;) {
    const [p, prog, rt] = await Promise.all([rover(page), program(page), page.evaluate(() => window.__paiSim.stats().realtimeFactor)]);
    samples.push(p);
    if (prog.time > 1) realtime.push(rt);
    expect(prog.state, `program failed: ${prog.error}`).toBe("running");
    if (prog.time >= 10) break;
    await page.waitForTimeout(300);
  }
  const path = samples.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - samples[i]![0], p[1] - samples[i]![1]), 0);
  expect(path).toBeGreaterThan(2);
  for (const [x, y] of samples) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThan(PEN_HALF - ROBOT_REACH);
  const sorted = [...realtime].sort((a, b) => a - b);
  expect(sorted[Math.floor(sorted.length / 2)], realtime.join(", ")).toBeGreaterThan(0.8);
  expect(errors).toEqual([]);
});

test("going back to blocks after editing the code asks first", async ({ page }) => {
  const { errors } = await openSim(page);
  await openBlocks(page);
  await viewButton(page, "Code").click();
  await editor(page).fill("function loop() {\n  robot.setWheels(0.1, 0.1); // mine\n}\n");

  // Say no: stay in the code view with the edits.
  page.once("dialog", (d) => {
    expect(d.message()).toContain("Blocks can't be made from code");
    void d.dismiss();
  });
  await viewButton(page, "Blocks").click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveValue(/\/\/ mine/);
  await expect(viewButton(page, "Code")).toHaveAttribute("aria-pressed", "true");

  // Say yes: the blocks' program replaces the edits.
  page.once("dialog", (d) => void d.accept());
  await viewButton(page, "Blocks").click();
  await expect(workspace(page)).toBeVisible();
  await viewButton(page, "Code").click();
  await expect(editor(page)).not.toHaveValue(/\/\/ mine/);
  await expect(editor(page)).toHaveValue(/robot\.setWheels\(0\.5, 0\.5\)/);
  expect(errors).toEqual([]);
});

test("an example loaded as code comes along as blocks", async ({ page }) => {
  const { errors } = await openSim(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await panel(page).getByLabel("Examples").selectOption({ label: "Follow a line" });
  await expect(editor(page)).toHaveValue(/Follow a line/);
  await viewButton(page, "Blocks").click();
  await expect(block(page, "left line probe")).toBeVisible();
  await expect(panel(page).locator(".c-status")).toContainText("Follow a line");
  await viewButton(page, "Code").click();
  await expect(editor(page)).toHaveValue(/robot\.read\("line_left"\)/);
  expect(errors).toEqual([]);
});

test("Blockly's menus close on switching view; Escape in the workspace closes the panel", async ({ page }) => {
  const { errors } = await openSim(page);
  await openBlocks(page);
  await block(page, "set wheels left").locator(".blocklyEditableField").first().click();
  const field = page.locator(".blocklyWidgetDiv input");
  await expect(field).toBeVisible();
  await viewButton(page, "Code").click();
  await expect(field).toBeHidden();

  await viewButton(page, "Blocks").click();
  await block(page, "set wheels left").locator(".blocklyEditableField").first().click();
  await expect(field).toBeVisible();
  await field.press("Escape"); // closes the field editor, not the panel
  await expect(field).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await workspace(page).locator(".blocklyWorkspace").first().focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test("keyboard: the view switch and the workspace are reachable, Ctrl+Enter runs from the blocks", async ({ page }) => {
  const { errors } = await openSim(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await panel(page).getByLabel("Examples").focus();
  await page.keyboard.press("Tab");
  await expect(viewButton(page, "Blocks")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(workspace(page).locator(".blocklySvg").first()).toBeVisible({ timeout: BLOCKLY_LOAD_MS });
  // Tab moves on into the workspace.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest(".c-blocks")))
    .toBe(true);
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => program(page).then((p) => p.wheels)).toEqual({ left: 0.5, right: 0.5 });
  expect(errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("blocks work by touch in the bottom sheet", async ({ page }) => {
    test.setTimeout(90_000);
    const { errors } = await openSim(page);
    await page.getByRole("button", { name: "Code", exact: true }).tap();
    await expect(panel(page)).toBeVisible();
    await viewButton(page, "Blocks").tap();
    await expect(workspace(page).locator(".blocklySvg").first()).toBeVisible({ timeout: BLOCKLY_LOAD_MS });
    const box = (await workspace(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(340);
    expect(box.height).toBeGreaterThan(200);
    await panel(page).getByLabel("Examples").selectOption({ label: "Follow a line" });
    await expect(block(page, "left line probe")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/blocks-phone.png` });
    await panel(page).getByRole("button", { name: "Run" }).tap();
    await expect.poll(async () => (await program(page)).time, { timeout: 15_000 }).toBeGreaterThan(3);
    const [x, y] = await rover(page);
    expect(Math.abs(Math.hypot(x, y) - LINE_RADIUS)).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });
});
