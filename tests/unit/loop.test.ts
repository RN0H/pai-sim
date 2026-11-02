/**
 * SimLoop: fixed-step catch-up is bounded so a user model with a tiny
 * timestep can't lock the page. PROTECTED: see CLAUDE.md.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_STEPS_PER_FRAME, SimLoop } from "../../src/app/loop";
import type { Sim } from "../../src/physics/engine";

function fakeSim(timestep: number) {
  let steps = 0;
  const sim = { timestep, step: () => void steps++ } as unknown as Sim;
  return { sim, steps: () => steps };
}

/** Drive the loop by hand: capture its rAF callback and call it with chosen times. */
function manualFrames() {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    cb = f;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return (now: number) => cb!(now);
}

afterEach(() => vi.unstubAllGlobals());

describe("SimLoop", () => {
  it("steps in real time for a normal timestep", () => {
    const frame = manualFrames();
    const { sim, steps } = fakeSim(0.002);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const loop = new SimLoop(sim, () => {}, () => {});
    loop.start();
    frame(100); // 0.1 s -> 50 steps (49 with float round-off in the accumulator)
    expect(steps()).toBeGreaterThanOrEqual(49);
    expect(steps()).toBeLessThanOrEqual(50);
    loop.stop();
  });

  it("caps steps per frame for tiny timesteps and drops the backlog", () => {
    const frame = manualFrames();
    const { sim, steps } = fakeSim(0.00001); // 0.25 s would be 25,000 steps
    vi.spyOn(performance, "now").mockReturnValue(0);
    const loop = new SimLoop(sim, () => {}, () => {});
    loop.start();
    frame(250);
    expect(steps()).toBe(MAX_STEPS_PER_FRAME);
    frame(251); // backlog dropped: only ~1 ms worth of new steps
    expect(steps() - MAX_STEPS_PER_FRAME).toBeLessThanOrEqual(101);
    loop.stop();
  });
});
