/**
 * Fixed-timestep simulation loop decoupled from render rate.
 * Physics advances in model.opt.timestep increments to keep results
 * deterministic; rendering happens once per animation frame.
 */
import type { Sim } from "../physics/engine";

// Let physics catch up on slow frames (low-end devices render at ~5-10 fps),
// but cap it so a backgrounded tab doesn't trigger a huge burst of steps.
const MAX_FRAME_SECONDS = 0.25;

export interface LoopStats {
  fps: number;
  /** Simulated seconds per wall-clock second (1.0 = real time). */
  realtimeFactor: number;
}

export class SimLoop {
  paused = false;
  readonly stats: LoopStats = { fps: 0, realtimeFactor: 0 };
  private accum = 0;
  private last = 0;
  private raf = 0;
  private frames = 0;
  private simTimeWindow = 0;
  private windowStart = 0;

  constructor(
    private sim: Sim,
    private readonly beforeStep: (sim: Sim) => void,
    private readonly onFrame: (sim: Sim) => void,
  ) {}

  setSim(sim: Sim): void {
    this.sim = sim;
    this.accum = 0;
  }

  start(): void {
    this.last = performance.now();
    this.windowStart = this.last;
    const tick = (now: number) => {
      const dt = Math.min((now - this.last) / 1000, MAX_FRAME_SECONDS);
      this.last = now;
      if (!this.paused) {
        this.accum += dt;
        const h = this.sim.timestep;
        while (this.accum >= h) {
          this.beforeStep(this.sim);
          this.sim.step();
          this.accum -= h;
          this.simTimeWindow += h;
        }
      }
      this.onFrame(this.sim);
      this.frames++;
      const elapsed = (now - this.windowStart) / 1000;
      if (elapsed >= 0.5) {
        this.stats.fps = this.frames / elapsed;
        this.stats.realtimeFactor = this.simTimeWindow / elapsed;
        this.frames = 0;
        this.simTimeWindow = 0;
        this.windowStart = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
