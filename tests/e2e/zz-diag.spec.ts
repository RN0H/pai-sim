// TEMPORARY CI diagnostic (to be removed): what blocks the page right after load.
import { test, type Page } from "@playwright/test";

async function probe(page: Page, label: string, drive: boolean) {
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[][]; __frames: number[] };
    w.__long = [];
    w.__frames = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
    } catch {}
    const f = (n: number) => { w.__frames.push(Math.round(n)); if (n < 9000) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.goto("./");
  await page.waitForFunction(() => window.__paiSim?.ready);
  const readyAt = await page.evaluate(() => Math.round(performance.now()));
  if (drive) await page.evaluate(() => window.__paiSim.setDrive(1, 0));
  const sims: string[] = [];
  for (let i = 0; i < 12; i++) {
    sims.push(await page.evaluate(() => `${Math.round(performance.now())}:${window.__paiSim.time().toFixed(2)}`));
    await page.waitForTimeout(400);
  }
  const r = await page.evaluate(() => {
    const w = window as unknown as { __long: number[][]; __frames: number[] };
    const fr = w.__frames; const gaps: string[] = [];
    for (let i = 1; i < fr.length; i++) if (fr[i]! - fr[i - 1]! > 300) gaps.push(`${fr[i - 1]}+${fr[i]! - fr[i - 1]!}`);
    return { long: w.__long.filter(([, d]) => d! > 200).map(([s, d]) => `${s}+${d}`).join(" "), gaps: gaps.join(" "), wasm: performance.getEntriesByType("resource").filter((e) => /wasm|js$/.test(e.name)).map((e) => `${e.name.split("/").pop()}@${Math.round(e.startTime)}-${Math.round((e as PerformanceResourceTiming).responseEnd)}`).join(" ") };
  });
  console.log(`DIAG ${label} ready@${readyAt}\n  long: ${r.long}\n  frameGaps: ${r.gaps}\n  sim(now:t): ${sims.join(" ")}\n  res: ${r.wasm}`);
}

test("diag A: idle after load", async ({ page }) => probe(page, "idle", false));
test("diag B: driving after load", async ({ page }) => probe(page, "drive", true));
test("diag C: idle again", async ({ page }) => probe(page, "idle2", false));
