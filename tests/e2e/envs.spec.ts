/**
 * M5 browser checks: the environment picker puts the builder's robot into
 * each environment, which loads with no errors and keeps real time; the
 * goal banner counts down and shows success and failure; programs run in
 * environments; environments that need a sensor offer a suitable template.
 * Environments are picked and programs written through the UI; test hooks
 * only read state.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screenshots";
const ENVS: { id: string; name: string }[] = [
  { id: "playground", name: "Playground" },
  { id: "maze", name: "Maze" },
  { id: "line", name: "Line track" },
  { id: "sumo", name: "Sumo ring" },
];

async function openSim(page: Page, query = ""): Promise<string[]> {
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

async function medianRealtime(page: Page): Promise<{ median: number; samples: number[] }> {
  await page.waitForTimeout(1500);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[2]!, samples };
}

const banner = (page: Page) => page.locator("#goal");
const goal = (page: Page) => page.evaluate(() => window.__paiSim.goal());
const codePanel = (page: Page) => page.getByRole("complementary", { name: "Program your robot" });

/** The reference controllers' code, read from tests/envs/reference.ts (the same programs the unit tests run). */
function referenceCode(env: string): string {
  const src = readFileSync(fileURLToPath(new URL("../envs/reference.ts", import.meta.url)), "utf8");
  const name = { playground: "PLAYGROUND", maze: "MAZE", line: "LINE", sumo: "SUMO" }[env]!;
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`no reference code for ${env}`);
  return m[1]!;
}

async function runProgram(page: Page, code: string) {
  await page.getByRole("button", { name: "Code", exact: true }).click();
  await expect(codePanel(page)).toBeVisible();
  await codePanel(page).getByRole("textbox", { name: "Program" }).fill(code);
  await codePanel(page).getByRole("button", { name: "Run" }).click();
  await expect.poll(() => page.evaluate(() => window.__paiSim.program().state)).toBe("running");
}

test("the picker switches through every environment with no errors and keeps real time", async ({ page }) => {
  const errors = await openSim(page);
  const picker = page.getByRole("combobox", { name: "Environment" });
  await expect(picker).toBeVisible();
  // A bundled scene is showing, so the picker invites a choice.
  await expect(picker).toHaveValue("");
  await expect(banner(page)).toBeHidden();

  for (const env of ENVS) {
    await picker.selectOption({ label: env.name });
    await expect.poll(() => page.evaluate(() => window.__paiSim.env())).toBe(env.id);
    expect(await page.evaluate(() => window.__paiSim.scene())).toBe("build");
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText(`${env.name}:`);
    await expect(banner(page)).toContainText(/\d:\d\d left/);
    // The robot spawned at the start pose and the world has props in it.
    expect(await page.evaluate(() => window.__paiSim.drawnGeoms())).toBeGreaterThan(10);
    const url = new URL(page.url());
    expect(url.searchParams.get("env")).toBe(env.id === "playground" ? null : env.id);
    expect(url.searchParams.get("scene")).toBeNull();
    const { median, samples } = await medianRealtime(page);
    expect(median, `${env.id}: ${samples.map((s) => s.toFixed(2)).join(", ")}`).toBeGreaterThan(0.8);
    await page.screenshot({ path: `${SHOTS}/env-${env.id}.png` });
  }

  // Back to a bundled scene: the banner goes away and the picker resets.
  await page.locator("#scene-picker").selectOption("hello");
  await expect(banner(page)).toBeHidden();
  await expect(picker).toHaveValue("");
  expect(await page.evaluate(() => window.__paiSim.env())).toBeNull();
  expect(errors).toEqual([]);
});

test("?env= opens the robot in that environment with a template that suits it", async ({ page }) => {
  const errors = await openSim(page, "?env=line");
  expect(await page.evaluate(() => window.__paiSim.env())).toBe("line");
  expect(await page.evaluate(() => window.__paiSim.builderSpec().name)).toBe("Sensor bot");
  await expect(page.getByRole("combobox", { name: "Environment" })).toHaveValue("line");
  await expect(page.locator("#scene-picker option:checked")).toHaveText("My robot: Sensor bot");
  await expect(page.locator("#goal-tip")).toBeHidden();
  const [x, y] = await page.evaluate(() => window.__paiSim.bodyPos("rover"));
  expect(x).toBeCloseTo(-0.4, 1);
  expect(y).toBeCloseTo(-0.6, 1);
  expect(errors).toEqual([]);
});

test("a robot missing a sensor gets a tip that swaps in a suitable template", async ({ page }) => {
  const errors = await openSim(page);
  // The default robot (Hauler) has no sensors.
  await page.getByRole("combobox", { name: "Environment" }).selectOption({ label: "Maze" });
  const tip = page.locator("#goal-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("distance sensor");
  await tip.getByRole("button", { name: "use the Sensor bot" }).click();
  await expect.poll(() => page.evaluate(() => window.__paiSim.builderSpec().sensors)).toContain("distance");
  await expect(tip).toBeHidden();
  expect(await page.evaluate(() => window.__paiSim.env())).toBe("maze");
  expect(errors).toEqual([]);
});

test("the line track's reference program finishes a lap and the banner says so", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openSim(page, "?env=line");
  await runProgram(page, referenceCode("line"));
  await expect.poll(() => goal(page).then((g) => g?.state), { timeout: 90_000 }).toBe("success");
  await expect(banner(page)).toHaveAttribute("data-state", "success");
  await expect(banner(page)).toContainText("Lap complete!");
  await expect(banner(page)).toContainText(/Time: \d+\.\d s/);
  await expect(page.locator("#goal-live")).toContainText("Lap complete!");
  await page.getByRole("button", { name: "Close the code panel" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/env-line-success.png` });
  expect(errors).toEqual([]);
});

test("sumo: leaving the ring fails, and Reset starts a fresh attempt", async ({ page }) => {
  const errors = await openSim(page, "?env=sumo");
  await expect(banner(page)).toContainText("0:45 left");
  await runProgram(page, "robot.setWheels(-1, -1);");
  await expect.poll(() => goal(page).then((g) => g?.state), { timeout: 30_000 }).toBe("fail");
  await expect(banner(page)).toHaveAttribute("data-state", "fail");
  await expect(banner(page)).toContainText("left the ring");
  await page.getByRole("button", { name: "Close the code panel" }).click();
  await page.screenshot({ path: `${SHOTS}/env-sumo-fail.png` });

  // Reset restarts the program (and the attempt) from the start pose.
  await page.locator("#reset").click();
  await expect.poll(() => goal(page).then((g) => g?.state)).toBe("running");
  await expect(banner(page)).toHaveAttribute("data-state", "running");
  expect(errors).toEqual([]);
});

test("the playground's reference program reaches the circle", async ({ page }) => {
  // The reference program is written for the Scout, the playground's template.
  const errors = await openSim(page, "?env=playground");
  expect(await page.evaluate(() => window.__paiSim.builderSpec().name)).toBe("Scout");
  await runProgram(page, referenceCode("playground"));
  await expect.poll(() => goal(page).then((g) => g?.state), { timeout: 30_000 }).toBe("success");
  await expect(banner(page)).toContainText("You reached the circle!");
  expect(errors).toEqual([]);
});

test("environment picker and goal banner fit a phone screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = await openSim(page, "?env=maze");
  const picker = page.getByRole("combobox", { name: "Environment" });
  await expect(picker).toBeVisible();
  await expect(banner(page)).toBeVisible();
  const box = (await banner(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // Both pickers and the file button fit on the row.
  for (const sel of ["#scene-picker", "#env-picker", ".file-button"]) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(390);
  }
  // The page doesn't scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await picker.selectOption({ label: "Sumo ring" });
  await expect.poll(() => page.evaluate(() => window.__paiSim.env())).toBe("sumo");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/env-phone.png` });
  expect(errors).toEqual([]);
  await context.close();
});
