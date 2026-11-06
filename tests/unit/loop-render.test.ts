/**
 * SimLoop skips drawing while a held program has fallen behind, so a slow
 * device has main-thread time for the worker round trips (one per control
 * tick), but it still draws every frame on fast devices and never goes
 * longer than MAX_RENDER_GAP_MS without drawing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RENDER_GAP_MS, SimLoop } from "../../src/app/loop";
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

function setup(hold: () => boolean) {
  const frame = manualFrames();
  let steps = 0;
  let renders = 0;
  const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
  const loop = new SimLoop(sim, hold, () => void renders++);
  vi.spyOn(performance, "now").mockReturnValue(0);
  loop.start();
  return { frame, loop, steps: () => steps, renders: () => renders };
}

describe("SimLoop drawing while a program holds physics", () => {
  it("draws every frame when nothing holds physics, however slow the frames", () => {
    const t = setup(() => true);
    for (let now = 150; now <= 1500; now += 150) t.frame(now);
    expect(t.renders()).toBe(10);
  });

  it("draws every frame on a fast device, where the program answers within the frame", () => {
    // Held at each 50 Hz tick, but the answer comes before the next 60 fps frame.
    let answered = true;
    const t = setup(() => {
      if (t.steps() % 10 === 0 && !answered) return false;
      answered = false;
      return true;
    });
    for (let i = 1; i <= 60; i++) {
      t.frame(i * (1000 / 60));
      answered = true;
      t.loop.pump();
    }
    expect(t.renders()).toBe(60);
  });

  it("skips drawing while held and behind, but draws at least every MAX_RENDER_GAP_MS", () => {
    const t = setup(() => false); // a program that hasn't answered
    let now = 0;
    const drawnAt: number[] = [];
    for (let i = 0; i < 60; i++) {
      now += 16;
      const before = t.renders();
      t.frame(now);
      if (t.renders() > before) drawnAt.push(now);
    }
    expect(t.renders()).toBeLessThan(10); // far fewer than 60 frames drawn
    expect(t.renders()).toBeGreaterThan(2);
    for (let i = 1; i < drawnAt.length; i++) {
      expect(drawnAt[i]! - drawnAt[i - 1]!).toBeLessThanOrEqual(MAX_RENDER_GAP_MS + 16);
    }
    expect(t.steps()).toBe(0);
  });

  it("draws every frame while paused", () => {
    const t = setup(() => false);
    t.loop.paused = true;
    for (let now = 16; now <= 160; now += 16) t.frame(now);
    expect(t.renders()).toBe(10);
  });
});
