/**
 * M4: SimLoop can hold physics while a controller program computes its next
 * command, and `pump()` continues with the steps owed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimLoop } from "../../src/app/loop";
import type { Sim } from "../../src/physics/engine";

afterEach(() => vi.unstubAllGlobals());

function manualFrames() {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    cb = f;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return (now: number) => cb!(now);
}

describe("SimLoop holds", () => {
  it("stops stepping while beforeStep returns false and continues on pump()", () => {
    const frame = manualFrames();
    let steps = 0;
    const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
    // Like a 50 Hz controller: wait for an answer before every 10th step.
    let answered = -1;
    const loop = new SimLoop(sim, () => steps % 10 !== 0 || answered === steps, () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    loop.start();
    frame(100); // 0.1 s: ~50 steps owed
    expect(steps).toBe(0); // held before the first step
    for (let tick = 1; tick <= 4; tick++) {
      answered = steps;
      loop.pump();
      expect(steps).toBe(10 * tick);
    }
    answered = steps;
    loop.pump(); // the last ~10 steps owed
    expect(steps).toBeGreaterThanOrEqual(49);
    expect(steps).toBeLessThanOrEqual(50);
  });

  it("pump() advances the owed steps once the hold is lifted, and never more than owed", () => {
    const frame = manualFrames();
    let steps = 0;
    const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
    let hold = true;
    const loop = new SimLoop(sim, () => !hold, () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    loop.start();
    frame(100);
    expect(steps).toBe(0);
    hold = false;
    loop.pump();
    expect(steps).toBeGreaterThanOrEqual(49);
    expect(steps).toBeLessThanOrEqual(50);
    const before = steps;
    loop.pump(); // nothing more is owed
    expect(steps).toBe(before);
  });

  it("caps the backlog while held, so a stuck program can't cause a burst of steps", () => {
    const frame = manualFrames();
    let steps = 0;
    const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
    let hold = true;
    const loop = new SimLoop(sim, () => !hold, () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    loop.start();
    for (let t = 100; t <= 3000; t += 100) frame(t); // held for 3 s
    hold = false;
    loop.pump();
    expect(steps).toBeLessThanOrEqual(125); // at most 0.25 s worth
  });

  it("pump() does nothing while paused", () => {
    const frame = manualFrames();
    let steps = 0;
    const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
    const loop = new SimLoop(sim, () => {}, () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    loop.start();
    loop.paused = true;
    frame(100);
    loop.pump();
    expect(steps).toBe(0);
  });
});
