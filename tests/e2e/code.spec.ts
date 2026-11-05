/**
 * M4 browser checks: the code panel runs programs in a Web Worker. Each
 * example program has its effect in the Sensor playground; a stuck program
 * (`while (true) {}`) is stopped with an error while the page stays
 * responsive; errors point at the right line. Programs are written and run
 * through the UI only; test hooks are used to read state.
 */
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
/** Inner half-size of the Sensor playground's pen (src/scenes/sensors.ts). */
const PEN_HALF = 1.5;
/** Farthest any part of the Sensor bot reaches from its centre, rounded up. */
const ROBOT_REACH = 0.15;
const LINE_RADIUS = 0.8;

async function openSim(page: Page, query = "?scene=sensors"): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("dialog", (d) => void d.accept());
  await page.goto(`./${query}`);
  await page.waitForFunction(() => window.__paiSim?.ready || window.__paiSim?.error, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return errors;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Program your robot" });
const editor = (page: Page) => panel(page).getByRole("textbox", { name: "Program" });
const program = (page: Page) => page.evaluate(() => window.__paiSim.program());
const rover = (page: Page) => page.evaluate(() => window.__paiSim.bodyPos("rover"));

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await expect(editor(page)).toBeFocused();
}

async function runExample(page: Page, name: string) {
  await panel(page).getByLabel("Examples").selectOption({ label: name });
  await expect(editor(page)).toHaveValue(new RegExp(name.split(" ")[0]!));
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("running");
}

/** Sample the rover's position until the program has run `seconds`. */
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

test("the Sensor playground scene loads with no errors and keeps real time", async ({ page }) => {
  const errors = await openSim(page);
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("sensors");
  await expect(page.locator("#scene-picker option:checked")).toHaveText("Sensor playground");
  expect(await page.evaluate(() => window.__paiSim.drawnGeoms())).toBeGreaterThan(50); // walls + line strips + robot
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  expect([...samples].sort((a, b) => a - b)[2], samples.join(", ")).toBeGreaterThan(0.8);
  await page.screenshot({ path: `${SHOTS}/scene-sensors.png` });
  expect(errors).toEqual([]);
});

test("square example drives a square and comes back to the start", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openSim(page);
  const start = await rover(page);
  await openPanel(page);
  await runExample(page, "Drive in a square");
  // The drive pad steps aside while a program drives.
  await expect(page.locator("#drive-pad")).toBeHidden();
  await expect(page.locator("#hint")).toContainText("Your program is driving");
  const samples = await sampleUntil(page, 11);
  const far = Math.max(...samples.map((p) => Math.hypot(p[0] - start[0], p[1] - start[1])));
  expect(far).toBeGreaterThan(0.5);
  const end = await rover(page);
  expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeLessThan(0.15);
  await page.screenshot({ path: `${SHOTS}/code-desktop.png` });

  // Stop hands the wheels back to the drive pad.
  await panel(page).getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("none");
  await expect(page.locator("#drive-pad")).toBeVisible();
  await expect(panel(page).getByRole("status")).toHaveText("Stopped.");
  expect(errors).toEqual([]);
});

test("avoid example doesn't hit a wall in 10 s", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openSim(page);
  await openPanel(page);
  await runExample(page, "Avoid obstacles");
  const samples = await sampleUntil(page, 10);
  const path = samples.slice(1).reduce((d, p, i) => d + Math.hypot(p[0] - samples[i]![0], p[1] - samples[i]![1]), 0);
  expect(path).toBeGreaterThan(2); // it moved around
  for (const [x, y] of samples) {
    expect(Math.max(Math.abs(x), Math.abs(y))).toBeLessThan(PEN_HALF - ROBOT_REACH);
  }
  expect(errors).toEqual([]);
});

test("a running program keeps real time", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  await runExample(page, "Avoid obstacles");
  await page.waitForTimeout(1000);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  expect([...samples].sort((a, b) => a - b)[2], samples.join(", ")).toBeGreaterThan(0.8);
  expect((await program(page)).state).toBe("running");
  expect(errors).toEqual([]);
});

test("follow example stays on the line", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await openSim(page);
  await openPanel(page);
  await runExample(page, "Follow a line");
  const samples = await sampleUntil(page, 10);
  for (const [x, y] of samples) expect(Math.abs(Math.hypot(x, y) - LINE_RADIUS)).toBeLessThan(0.05);
  const end = samples[samples.length - 1]!;
  // Anticlockwise from (0, -0.8): after 10 s it's well round the circle.
  expect(Math.atan2(end[1], end[0])).toBeGreaterThan(-Math.PI / 2 + 1);
  expect(errors).toEqual([]);
});

/** Animation frames the page draws in 800 ms. */
const framesIn800ms = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((done) => {
        let n = 0;
        const start = performance.now();
        const f = () => (performance.now() - start < 800 ? (n++, requestAnimationFrame(f)) : done(n));
        requestAnimationFrame(f);
      }),
  );

/**
 * While a program is stuck, the page renders at about its normal frame rate
 * (`baseline`, measured before), and buttons and typing work.
 */
async function expectResponsive(page: Page, baseline: number, held: boolean) {
  const simTime = await page.evaluate(() => window.__paiSim.time());
  const frames = await framesIn800ms(page);
  expect(frames).toBeGreaterThanOrEqual(Math.max(2, Math.floor(baseline / 2)));
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await editor(page).press("End");
  await editor(page).type(" // typed while stuck");
  await expect(editor(page)).toHaveValue(/typed while stuck/);
  // Physics is held at the control tick while the program hasn't answered.
  if (held) expect(await page.evaluate(() => window.__paiSim.time())).toBeCloseTo(simTime, 1);
}

test("an endless loop in the top-level code is stopped too", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  await editor(page).fill("robot.setWheels(1, 1);\nwhile (true) {}\n");
  const baseline = await framesIn800ms(page);
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expectResponsive(page, baseline, true); // the watchdog waits 5 s here
  const alert = panel(page).getByRole("alert");
  await expect(alert).toContainText("top-level code didn't finish within 5 seconds", { timeout: 10_000 });
  expect((await program(page)).state).toBe("failed");
  expect((await program(page)).wheels).toEqual({ left: 0, right: 0 });
  expect(errors).toEqual([]);
});

test("a program can't message the page or use the network, nor dodge the watchdog", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  await editor(page).fill(
    "console.log(typeof postMessage, typeof fetch, typeof XMLHttpRequest, typeof importScripts, typeof Object.getPrototypeOf(self).postMessage);\n",
  );
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(panel(page).getByLabel("Program output")).toHaveText("undefined undefined undefined undefined undefined");
  // Taking over the worker's message handler doesn't dodge the watchdog either.
  await editor(page).fill("function loop() {\n  try { self.onmessage = null; } catch (e) {}\n  while (true) {}\n}\n");
  await panel(page).getByRole("button", { name: "Restart" }).click();
  await expect(panel(page).getByRole("alert")).toContainText("didn't finish", { timeout: 10_000 });
  expect(errors).toEqual([]);
});

test("changing the scene stops the program; scenes without a robot say so", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => program(page).then((p) => p.state)).toBe("running");
  await page.locator("#scene-picker").selectOption("hello");
  await expect.poll(() => program(page).then((p) => p.state)).toBe("none");
  await expect(panel(page).getByRole("status")).toContainText("the scene changed");
  await expect(page.locator("#drive-pad")).toBeVisible();
  await page.locator("#scene-picker").selectOption("arm");
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(panel(page).getByRole("status")).toContainText("no robot to drive");
  expect((await program(page)).state).toBe("none");
  expect(errors).toEqual([]);
});

test("an endless loop is stopped with an error and the page stays responsive", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  await editor(page).fill("let n = 0;\nfunction loop() {\n  while (true) {}\n}\n");
  const baseline = await framesIn800ms(page);
  await panel(page).getByRole("button", { name: "Run" }).click();
  // While the worker is stuck the page still renders and reacts (the 1 s watchdog may fire meanwhile).
  await expectResponsive(page, baseline, false);

  const alert = panel(page).getByRole("alert");
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(alert).toContainText("Your loop() didn't finish within 1 second");
  expect((await program(page)).state).toBe("failed");
  // Physics carries on after the program is stopped.
  const t1 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__paiSim.time())).toBeGreaterThan(t1);

  // A fixed program runs in a fresh worker.
  await editor(page).fill("function loop() {\n  robot.setWheels(0.5, 0.5);\n}\n");
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(alert).toBeHidden();
  await expect.poll(async () => (await program(page)).time, { timeout: 10_000 }).toBeGreaterThan(0.5);
  expect((await program(page)).wheels).toEqual({ left: 0.5, right: 0.5 });
  expect(errors).toEqual([]);
});

test("errors name the line, and Show line selects it", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  const alert = panel(page).getByRole("alert");

  await editor(page).fill('function loop() {\n  robot.setWheels(0.2, 0.2);\n  const d = robot.read("lidar");\n}\n');
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(alert).toContainText('Line 3: There\'s no sensor called "lidar". This robot has: "distance", "line_left", "line_right".');
  await alert.getByRole("button", { name: "Show line" }).click();
  await expect(editor(page)).toBeFocused();
  const selected = await editor(page).evaluate((t: HTMLTextAreaElement) => t.value.slice(t.selectionStart, t.selectionEnd));
  expect(selected).toBe('  const d = robot.read("lidar");');
  await page.screenshot({ path: `${SHOTS}/code-error.png` });

  await editor(page).fill("function loop() {\n  robot.setWheels(1, 1;\n}\n");
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(alert).toContainText("Line 2: This code can't be read");

  // console.log output shows in the panel.
  await editor(page).fill('console.log("hello from the robot", robot.read("distance") > 0);\n');
  await panel(page).getByRole("button", { name: "Run" }).click();
  await expect(alert).toBeHidden();
  await expect(panel(page).getByLabel("Program output")).toHaveText("hello from the robot true");
  expect(errors).toEqual([]);
});

test("keyboard: typing in the editor doesn't drive, Ctrl+Enter runs, Escape closes", async ({ page }) => {
  const errors = await openSim(page);
  await openPanel(page);
  const before = await rover(page);
  await editor(page).press("ArrowUp");
  await editor(page).press("ArrowUp");
  await page.waitForTimeout(300);
  const after = await rover(page);
  expect(Math.abs(after[0] - before[0])).toBeLessThan(0.01);

  await editor(page).fill("robot.setWheels(-0.3, 0.3);\n");
  await editor(page).press("Control+Enter");
  await expect.poll(() => program(page).then((p) => p.wheels.left)).toBe(-0.3);

  // Reset restarts the running program from the beginning.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Reset" }).click();
  expect((await program(page)).time).toBeLessThan(0.3);
  await expect.poll(() => program(page).then((p) => p.state)).toBe("running");

  await editor(page).press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Code", exact: true })).toBeFocused();
  // Opening the builder closes the code panel and vice versa.
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(panel(page)).toBeHidden();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Build your robot" })).toBeHidden();
  expect(errors).toEqual([]);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the code panel is a bottom sheet and runs an example by touch", async ({ page }) => {
    const errors = await openSim(page);
    await page.getByRole("button", { name: "Code", exact: true }).tap();
    await expect(panel(page)).toBeVisible();
    // No on-screen keyboard popping up over the sim: focus goes to the examples menu.
    await expect(panel(page).getByLabel("Examples")).toBeFocused();
    // The header's buttons still fit on one row beside the name.
    const brand = (await page.locator(".brand").boundingBox())!;
    const reset = (await page.getByRole("button", { name: "Reset" }).boundingBox())!;
    expect(Math.abs(reset.y - brand.y)).toBeLessThan(20);
    const box = (await panel(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(380);
    expect(box.y).toBeGreaterThan(300); // a sheet at the bottom, sim still visible above
    await panel(page).getByLabel("Examples").selectOption({ label: "Follow a line" });
    await panel(page).getByRole("button", { name: "Run" }).tap();
    await expect.poll(async () => (await program(page)).time, { timeout: 15_000 }).toBeGreaterThan(2);
    const [x, y] = await rover(page);
    expect(Math.abs(Math.hypot(x, y) - LINE_RADIUS)).toBeLessThan(0.05);
    await page.screenshot({ path: `${SHOTS}/code-phone.png` });
    expect(errors).toEqual([]);
  });
});
