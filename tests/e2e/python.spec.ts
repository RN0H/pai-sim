/**
 * M4 stretch goal: Python programs in the browser (Pyodide in a Web
 * Worker, loaded from our own site on first use). Each Python example has
 * its effect in the Sensor playground; Python keeps real time; errors name
 * the line; a stuck program is stopped; Python can't reach the network; a
 * failed download gives a friendly error. Through the UI only; test hooks
 * read state.
 */
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
const PEN_HALF = 1.5;
const ROBOT_REACH = 0.15;
const LINE_RADIUS = 0.8;
/** Loading Pyodide in software-rendered CI Chrome takes a few seconds; allow plenty. */
const LOAD_MS = 60_000;

async function openSim(page: Page, query = "?scene=sensors", dialogs: "accept" | "dismiss" = "accept"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("dialog", (d) => void (dialogs === "accept" ? d.accept() : d.dismiss()));
  await page.goto(`./${query}`);
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return errors;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Program your robot" });
const editor = (page: Page) => panel(page).getByRole("textbox", { name: "Program" });
const program = (page: Page) => page.evaluate(() => window.__paiSim.program());
const rover = (page: Page) => page.evaluate(() => window.__paiSim.bodyPos("rover"));
const alert = (page: Page) => panel(page).getByRole("alert");

async function openPython(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByLabel("Language").selectOption("Python");
  await expect(editor(page)).toHaveValue(/def loop\(\):/);
}

async function run(page: Page, button: "Run" | "Restart" = "Run") {
  await panel(page).getByRole("button", { name: button }).click();
  await expect.poll(() => program(page).then((p) => p.state === "running" && p.language === "python")).toBe(true);
}

async function waitLoaded(page: Page) {
  const status = () => program(page).then((p) => (p.loaded ? "loaded" : p.state === "running" ? "loading" : `${p.state}: ${p.error}`));
  await expect.poll(status, { timeout: LOAD_MS }).not.toBe("loading"); // fails fast on an error
  expect(await status()).toBe("loaded");
}

async function runExample(page: Page, name: string) {
  await panel(page).getByLabel("Examples").selectOption({ label: name });
  await expect(editor(page)).toHaveValue(/def loop\(\):/);
  await run(page);
  await waitLoaded(page);
}

async function sampleUntil(page: Page, seconds: number): Promise<[number, number, number][]> {
  const samples: [number, number, number][] = [];
  for (;;) {
    const [p, prog] = await Promise.all([rover(page), program(page)]);
    samples.push(p);
    expect(prog.state, `program failed: ${prog.error}`).toBe("running");
    if (prog.time >= seconds) return samples;
    await page.waitForTimeout(100);
  }
}

test("python square example loads Python from our own site and drives a square", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSim(page);
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:4173/") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) foreign.push(r.url());
  });
  const workers: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  const pyodideRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/pyodide/")) pyodideRequests.push(r.url());
  });
  const start = await rover(page);
  await openPython(page);
  // Nothing of Python is downloaded until a Python program runs.
  expect(pyodideRequests).toEqual([]);
  await panel(page).getByLabel("Examples").selectOption({ label: "Drive in a square" });
  await expect(editor(page)).toHaveValue(/robot\.set_wheels\(SPEED, SPEED\)/);
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(panel(page).getByRole("status")).toContainText("Loading Python");
  // Physics waits for Python, so the program starts at the start.
  expect((await program(page)).time).toBe(0);
  await waitLoaded(page);
  await expect(panel(page).getByRole("status")).toContainText("Running on");
  expect(pyodideRequests.length).toBeGreaterThan(0);
  const samples = await sampleUntil(page, 11);
  const far = Math.max(...samples.map((p) => Math.hypot(p[0] - start[0], p[1] - start[1])));
  expect(far).toBeGreaterThan(0.5);
  const end = await rover(page);
  expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(0.15);
  await page.screenshot({ path: `${SHOTS}/python-desktop.png` });
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

test("python avoid example doesn't hit a wall, and keeps real time", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSim(page);
  await openPython(page);
  await runExample(page, "Avoid obstacles");
  await page.waitForTimeout(1000);
  const rates: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    rates.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  expect([...rates].sort((a, b) => a - b)[2], rates.join(", ")).toBeGreaterThan(0.8);
  const samples = await sampleUntil(page, 10);
  for (const [x, y] of samples) expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThan(PEN_HALF - ROBOT_REACH);
  expect(errors).toEqual([]);
});

test("python follow example stays on the line", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSim(page);
  await openPython(page);
  await runExample(page, "Follow a line");
  const samples = await sampleUntil(page, 8);
  for (const [x, y] of samples) expect(Math.abs(Math.hypot(x, y) - LINE_RADIUS)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});

test("python errors name the line, print shows output, and a stuck loop is stopped", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSim(page);
  await openPython(page);

  await editor(page).fill('def loop():\n    robot.set_wheels(0.2, 0.2)\n    d = robot.read("lidar")\n');
  await run(page);
  await expect(alert(page)).toContainText(
    `Line 3: There's no sensor called 'lidar'. This robot has: "distance", "line_left", "line_right".`,
    { timeout: LOAD_MS },
  );
  await alert(page).getByRole("button", { name: "Show line" }).click();
  await expect(editor(page)).toBeFocused();
  const selected = await editor(page).evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(selected).toBe('    d = robot.read("lidar")');
  await page.screenshot({ path: `${SHOTS}/python-error.png` });

  await editor(page).fill("def loop()\n    pass\n");
  await run(page);
  await expect(alert(page)).toContainText("Line 1: This code can't be read", { timeout: LOAD_MS });

  await editor(page).fill('print("hello from python", robot.read("distance") > 0)\n');
  await run(page);
  await expect(panel(page).getByLabel("Program output")).toHaveText("hello from python True", { timeout: LOAD_MS });

  // A loop that never ends is stopped by the watchdog; the page keeps going.
  await editor(page).fill("def loop():\n    while True:\n        pass\n");
  await run(page, "Restart");
  await expect(alert(page)).toContainText("Your loop() didn't finish within 1 second", { timeout: LOAD_MS });
  expect((await program(page)).state).toBe("failed");
  const t1 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__paiSim.time())).toBeGreaterThan(t1);

  // A fixed program runs in a fresh worker.
  await editor(page).fill("def loop():\n    robot.set_wheels(0.5, 0.5)\n");
  await run(page);
  await expect(alert(page)).toBeHidden();
  await expect.poll(async () => (await program(page)).time, { timeout: LOAD_MS }).toBeGreaterThan(0.5);
  expect((await program(page)).wheels).toEqual({ left: 0.5, right: 0.5 });
  expect(errors).toEqual([]);
});

test("python can't message the page or use the network", async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await openSim(page);
  await openPython(page);
  await editor(page).fill("import js\nprint(js.fetch, js.XMLHttpRequest, js.postMessage, js.importScripts, js.WebSocket, js.FontFace, js.fonts)\n");
  await run(page);
  await expect(panel(page).getByLabel("Program output")).toHaveText("None None None None None None None", { timeout: LOAD_MS });
  expect(errors).toEqual([]);
});

test("each language keeps its own code; Blocks switch back to JavaScript", async ({ page }) => {
  const errors = await openSim(page);
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await editor(page).fill("// my javascript\n");
  await panel(page).getByLabel("Language").selectOption("Python");
  await expect(editor(page)).toHaveValue(/def loop\(\):/);
  await expect(panel(page).locator("#code-help")).toContainText("robot.set_wheels(left, right)");
  await editor(page).fill("# my python\n");
  await panel(page).getByLabel("Language").selectOption("JavaScript");
  await expect(editor(page)).toHaveValue("// my javascript\n");
  await panel(page).getByLabel("Language").selectOption("Python");
  await expect(editor(page)).toHaveValue("# my python\n");
  // Blocks make JavaScript.
  await panel(page).getByRole("button", { name: "Blocks" }).click();
  await expect(panel(page).getByRole("region", { name: /Blocks workspace/ })).toBeVisible({ timeout: 20_000 });
  await panel(page).getByRole("button", { name: "Code", exact: true }).click();
  await expect(panel(page).getByLabel("Language")).toHaveValue("javascript");
  await panel(page).getByLabel("Language").selectOption("Python");
  await expect(editor(page)).toHaveValue("# my python\n");
  expect(errors).toEqual([]);
});

test("stopping or switching scene while Python loads leaves nothing running", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openSim(page);
  await openPython(page);
  await run(page);
  expect((await program(page)).loaded).toBe(false);
  await panel(page).getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("none");
  await expect(panel(page).getByRole("status")).toHaveText("Stopped.");
  await run(page);
  await page.locator("#scene-picker").selectOption("hello");
  await expect.poll(() => program(page).then((p) => p.state)).toBe("none");
  // Nothing comes back later to start driving.
  await page.waitForTimeout(8000);
  expect((await program(page)).state).toBe("none");
  await expect(panel(page).getByRole("status")).toContainText("the scene changed");
  expect(errors).toEqual([]);
});

test("cancelling the switch to Blocks keeps the Python code", async ({ page }) => {
  const errors = await openSim(page, "?scene=sensors", "dismiss");
  await openPython(page);
  await editor(page).fill("# my python\n");
  await panel(page).getByLabel("Language").selectOption("JavaScript");
  await editor(page).fill("// my javascript\n"); // edited code: Blocks asks first
  await panel(page).getByLabel("Language").selectOption("Python");
  await panel(page).getByRole("button", { name: "Blocks" }).click();
  await expect(panel(page).getByLabel("Language")).toHaveValue("python");
  await expect(editor(page)).toHaveValue("# my python\n");
  expect(errors).toEqual([]);
});

for (const file of ["pyodide.mjs", "pyodide.asm.wasm"]) test(`if Python can't download (${file}), the error says so and JavaScript still runs`, async ({ page }) => {
  test.setTimeout(90_000);
  await page.route(`**/pyodide/${file}`, (r) => r.fulfill({ status: 404, body: "not found" }));
  const errors = await openSim(page);
  await openPython(page);
  await run(page);
  await expect(alert(page)).toContainText("Python couldn't start", { timeout: LOAD_MS });
  expect((await program(page)).state).toBe("failed");
  await panel(page).getByLabel("Language").selectOption("JavaScript");
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => program(page).then((p) => p.language)).toBe("javascript");
  await expect.poll(async () => (await program(page)).time, { timeout: 10_000 }).toBeGreaterThan(0.3);
  // The browser logs the failed download itself; nothing else may go wrong.
  expect(errors.filter((e) => !/404|Failed to load resource|pyodide/i.test(e))).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a python example runs by touch", async ({ page }) => {
    test.setTimeout(150_000);
    const errors = await openSim(page);
    await page.getByRole("button", { name: "Code", exact: true }).tap();
    await panel(page).getByLabel("Language").selectOption("Python");
    await panel(page).getByLabel("Examples").selectOption({ label: "Follow a line" });
    await panel(page).getByRole("button", { name: "Run" }).tap();
    await expect.poll(async () => (await program(page)).time, { timeout: LOAD_MS }).toBeGreaterThan(2);
    const [x, y] = await rover(page);
    expect(Math.abs(Math.hypot(x, y) - LINE_RADIUS)).toBeLessThan(0.05);
    await page.screenshot({ path: `${SHOTS}/python-phone.png` });
    expect(errors).toEqual([]);
  });
});
