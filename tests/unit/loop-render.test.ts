/**
 * SimLoop skips drawing while a held program has fallen behind and drawing
 * is slow, so a slow device has main-thread time for the worker round trips
 * (one per control tick). It still draws every frame on fast devices (even
 * when the program is what's slow) and never goes longer than
 * MAX_RENDER_GAP_MS without drawing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RENDER_GAP_MS, SimLoop } from "../../src/app/loop";
import type { Sim } from "../../src/physics/engine";

afterEach(() => vi.unstubAllGlobals());

/**
 * A fake device: a drawn frame takes `drawMs` until the next animation
 * frame; a skipped one takes `idleMs`. Returns the times frames were drawn.
 */
function device(hold: () => boolean, drawMs: number, idleMs = 16) {
  let cb: FrameRequestCallback | null = null;
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    cb = f;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(performance, "now").mockReturnValue(0);
  let steps = 0;
  let drew = false;
  const sim = { timestep: 0.002, step: () => void steps++ } as unknown as Sim;
  const loop = new SimLoop(sim, hold, () => void (drew = true));
  loop.start();
  let now = 0;
  const drawnAt: number[] = [];
  let frames = 0;
  return {
    loop,
    steps: () => steps,
    frames: () => frames,
    drawnAt,
    /** Run frames until `ms` have passed; `between` runs after each frame (e.g. a worker answer). */
    run(ms: number, between?: () => void) {
      const end = now + ms;
      while (now < end) {
        now += drew ? drawMs : idleMs;
        drew = false;
        cb!(now);
        frames++;
        if (drew) drawnAt.push(now);
        between?.();
      }
    },
  };
}

describe("SimLoop drawing while a program holds physics", () => {
  it("draws every frame when nothing holds physics, however slow the frames", () => {
    const d = device(() => true, 150);
    d.run(1500);
    expect(d.drawnAt.length).toBe(d.frames());
    expect(d.steps()).toBeGreaterThan(600); // keeps real time (capped at 0.25 s per frame)
  });

  it("draws every frame on a fast device, where the program answers within the frame", () => {
    let answered = true;
    const d = device(() => {
      if (d.steps() % 10 === 0 && !answered) return false;
      answered = false;
      return true;
    }, 1000 / 60);
    d.run(1000, () => {
      answered = true;
      d.loop.pump();
    });
    expect(d.frames()).toBeGreaterThanOrEqual(60);
    expect(d.drawnAt.length).toBe(d.frames());
  });

  it("draws every frame on a fast device when the program is what's slow", () => {
    const d = device(() => false, 16); // never answers, but drawing is quick
    d.run(1000);
    expect(d.frames()).toBeGreaterThanOrEqual(60);
    expect(d.drawnAt.length).toBe(d.frames());
  });

  it("skips drawing while held, behind and slow to draw, but draws at least every MAX_RENDER_GAP_MS", () => {
    const d = device(() => false, 150); // software GL: 150 ms per drawn frame
    d.run(3000);
    // Drawn frames: the first ones, then one per MAX_RENDER_GAP_MS (+ a frame's slack).
    expect(d.drawnAt.length).toBeLessThan(3000 / MAX_RENDER_GAP_MS + 3);
    expect(d.drawnAt.length).toBeGreaterThan(5);
    for (let i = 1; i < d.drawnAt.length; i++) {
      expect(d.drawnAt[i]! - d.drawnAt[i - 1]!).toBeLessThanOrEqual(MAX_RENDER_GAP_MS + 150);
    }
    expect(d.steps()).toBe(0);
  });

  it("draws every frame while paused", () => {
    const d = device(() => false, 150);
    d.loop.paused = true;
    d.run(1500);
    expect(d.drawnAt.length).toBe(d.frames());
  });
});
