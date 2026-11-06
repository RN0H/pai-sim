// TEMPORARY CI diagnostic (to be removed): timing right after load.
import { test } from "@playwright/test";
test("diag: first seconds after load", async ({ page }) => {
  await page.goto("./");
  await page.waitForFunction(() => window.__paiSim?.ready);
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const e = gl?.getExtension("WEBGL_debug_renderer_info");
    return { renderer: gl && e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null, cores: navigator.hardwareConcurrency };
  });
  console.log("DIAG", JSON.stringify(info));
  await page.evaluate(() => window.__paiSim.setDrive(1, 0));
  const t0 = Date.now();
  for (let i = 0; i < 16; i++) {
    const s = await page.evaluate(() => ({ t: window.__paiSim.time(), x: window.__paiSim.bodyPos("rover")[0], ...window.__paiSim.stats() }));
    console.log("DIAG", Date.now() - t0, JSON.stringify(s));
    await page.waitForTimeout(250);
  }
  const gaps = await page.evaluate(() => new Promise<number[]>((done) => { const t0 = performance.now(); let last = t0; const g: number[] = []; const f = (n: number) => { g.push(Math.round(n - last)); last = n; if (n - t0 < 2000) requestAnimationFrame(f); else done(g); }; requestAnimationFrame(f); }));
  console.log("DIAG gaps", gaps.join(","));
});
