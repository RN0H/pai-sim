/**
 * M3 browser checks: a beginner builds a rover through the builder panel
 * only (clicks, taps, keys; test hooks are used to read state, never to
 * build), drives it, and sees plain-language errors.
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
  expect(await page.evaluate(() => window.__paiSim.error), "simulator failed to load").toBeNull();
  return errors;
}

const spec = (page: Page) => page.evaluate(() => window.__paiSim.builderSpec());
const roverX = async (page: Page) => (await page.evaluate(() => window.__paiSim.bodyPos("rover")))[0];

test("builds a rover from scratch with clicks, keeps the camera, and drives it", async ({ page }) => {
  const errors = await openSim(page);
  const panel = page.getByRole("complementary", { name: "Build your robot" });
  await expect(panel).toBeHidden();

  await page.getByRole("button", { name: "Build", exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(page.getByRole("button", { name: "Build", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(500); // let the canvas resize and orbit damping settle
  const cam0 = await page.evaluate(() => window.__paiSim.cameraPos());

  // Pick every part by hand.
  await panel.getByRole("radio", { name: /Small chassis/ }).click();
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("build");
  await panel.getByRole("radio", { name: /Large wheels/ }).click();
  await panel.getByRole("radio", { name: /Fast motors/ }).click();
  await panel.getByRole("checkbox", { name: /Distance sensor/ }).check();
  await panel.getByRole("checkbox", { name: /Line sensor/ }).check();
  await panel.getByRole("textbox", { name: "Name" }).fill("Zoomy");
  await panel.getByRole("textbox", { name: "Name" }).press("Enter");

  await expect
    .poll(() => spec(page))
    .toMatchObject({ name: "Zoomy", chassis: "chassis_small", wheels: "wheel_large", motor: "motor_fast", sensors: ["distance", "line"] });
  await expect(page.locator("#scene-picker option:checked")).toHaveText("My robot: Zoomy");
  expect(await page.evaluate(() => window.__paiSim.modelName())).toBe("Zoomy");

  // Rebuilding kept the user's view.
  const cam1 = await page.evaluate(() => window.__paiSim.cameraPos());
  for (let i = 0; i < 3; i++) expect(cam1[i]!).toBeCloseTo(cam0[i]!, 3);

  // Drive it with the on-screen pad.
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/builder-desktop.png` });
  const x0 = await roverX(page);
  await page.getByRole("button", { name: "Forward" }).hover();
  await page.mouse.down();
  await page.waitForTimeout(1500);
  await page.mouse.up();
  expect((await roverX(page)) - x0).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});

test("templates load from the panel and the sim keeps real time while building", async ({ page }) => {
  await openSim(page);
  await page.getByRole("button", { name: "Build", exact: true }).click();
  for (const [name, chassis] of [
    ["Scout", "chassis_small"],
    ["Sensor bot", "chassis_medium"],
    ["Hauler", "chassis_large"],
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect.poll(() => spec(page)).toMatchObject({ name, chassis });
    await expect(page.getByRole("radio", { name: new RegExp(`${chassis.replace("chassis_", "")} chassis`, "i") })).toBeChecked();
  }
  await page.waitForTimeout(3500);
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(600);
    samples.push(await page.evaluate(() => window.__paiSim.stats().realtimeFactor));
  }
  samples.sort((a, b) => a - b);
  expect(samples[2]!, `samples: ${samples.map((s) => s.toFixed(2)).join(", ")}`).toBeGreaterThan(0.8);
});

test("invalid names show an inline error and the robot keeps running", async ({ page }) => {
  await openSim(page);
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("button", { name: /^Scout/ }).click();
  await expect.poll(() => page.evaluate(() => window.__paiSim.scene())).toBe("build");

  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("");
  await expect(page.getByText("Give the robot a name.")).toBeVisible();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Give the robot a name.");
  await name.press("Enter");
  await name.fill("x".repeat(45));
  await expect(page.getByText(/too long \(45 characters\)/)).toBeVisible();
  await name.blur();

  // Nothing was rebuilt; the Scout keeps simulating.
  expect((await spec(page)).name).toBe("Scout");
  const t0 = await page.evaluate(() => window.__paiSim.time());
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__paiSim.time())).toBeGreaterThan(t0 + 0.2);

  // Fixing the name clears the error and builds.
  await name.fill("Scout 2");
  await name.press("Enter");
  await expect(page.getByText("Give the robot a name.")).toBeHidden();
  await expect(name).toHaveAttribute("aria-invalid", "false");
  await expect.poll(async () => (await spec(page)).name).toBe("Scout 2");
  await page.screenshot({ path: `${SHOTS}/builder-error.png` });
});

test("the builder works from the keyboard alone", async ({ page }) => {
  await openSim(page);
  const toggle = page.getByRole("button", { name: "Build", exact: true });
  await toggle.focus();
  await page.keyboard.press("Enter");
  // Focus moves into the panel, to the first template.
  await expect(page.getByRole("button", { name: /^Scout/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await spec(page)).name).toBe("Scout");

  // Arrow keys move through a radio group (and don't drive the robot).
  const x0 = await roverX(page);
  await page.getByRole("radio", { name: /Small chassis/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await spec(page)).chassis).toBe("chassis_medium");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await spec(page)).chassis).toBe("chassis_large");
  await page.waitForTimeout(300);
  expect(Math.abs((await roverX(page)) - x0)).toBeLessThan(0.05);

  // Space toggles a sensor checkbox.
  await page.getByRole("checkbox", { name: /Distance sensor/ }).focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await spec(page)).sensors).toEqual(["distance"]);

  // Escape closes the panel and returns focus to the toggle.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Build your robot" })).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("phone: builds and drives a rover from the bottom sheet with touch", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = await openSim(page);
  await page.getByRole("button", { name: "Build", exact: true }).tap();
  const panel = page.getByRole("complementary", { name: "Build your robot" });
  await expect(panel).toBeVisible();

  await panel.getByRole("radio", { name: /Medium chassis/ }).tap();
  await panel.getByRole("radio", { name: /Large wheels/ }).tap();
  await panel.getByRole("radio", { name: /Fast motors/ }).tap();
  await panel.getByRole("checkbox", { name: /Distance sensor/ }).tap();
  await expect
    .poll(() => spec(page))
    .toMatchObject({ chassis: "chassis_medium", wheels: "wheel_large", motor: "motor_fast", sensors: ["distance"] });
  expect(await page.evaluate(() => window.__paiSim.scene())).toBe("build");

  // The sheet sits below the 3D view: the drive pad stays visible and tappable.
  const pad = await page.locator("#drive-pad").boundingBox();
  const sheet = await panel.boundingBox();
  expect(pad && sheet).toBeTruthy();
  expect(pad!.y + pad!.height).toBeLessThanOrEqual(sheet!.y + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "no horizontal scroll").toBe(false);

  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/builder-phone.png` });
  const x0 = await roverX(page);
  const fwd = page.getByRole("button", { name: "Forward" });
  await fwd.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(1500);
  await fwd.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
  expect((await roverX(page)) - x0).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
  await page.close();
});
