/**
 * Fixed-timestep simulation loop decoupled from render rate.
 * Physics advances in model.opt.timestep increments to keep results
 * deterministic; rendering happens once per animation frame.
 */
import type { Sim } from "../physics/engine";

// Let physics catch up on slow frames (low-end devices render at ~5-10 fps),
// but cap it so a backgrounded tab doesn't trigger a huge burst of steps.
const MAX_FRAME_SECONDS = 0.25;
// Hard cap on physics steps per frame. A user model with a tiny timestep
// (e.g. 0.0001 s) would otherwise need thousands of steps per frame and could
// lock the tab on a slow device; past the cap it simply runs slower than real time.
export const MAX_STEPS_PER_FRAME = 1000;
// While a controller program holds physics (lockstep, see src/control/), each
// control tick needs a message round trip to its worker, and a message can
// only be handled between frames. On a device that spends a whole frame
// rendering (software GL: ~150 ms), that's one tick per frame, i.e. ~20% of
// real time. So when physics is held and has fallen behind, skip drawing for
// a while to leave the main thread free for the round trips.
/** Backlog (s) past which a held frame skips drawing. Fast devices never get this far behind. */
export const BEHIND_SECONDS = 0.05;
/** But draw at least this often (ms), so the view never freezes. */
export const MAX_RENDER_GAP_MS = 250;

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
  private lastRender = -Infinity;
  /** The last run() stopped because beforeStep held physics. */
  private held = false;

  /**
   * @param beforeStep called before every physics step. Returning `false`
   *   holds physics (e.g. while a controller program computes its next
   *   command); call `pump()` to continue once it's ready.
   */
  constructor(
    private sim: Sim,
    private readonly beforeStep: (sim: Sim) => boolean | void,
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
        // While held, don't pile up more than one frame's worth of backlog.
        this.accum = Math.min(this.accum + dt, MAX_FRAME_SECONDS);
        this.run();
      }
      const behind = !this.paused && this.held && this.accum > BEHIND_SECONDS;
      if (!behind || now - this.lastRender >= MAX_RENDER_GAP_MS) {
        this.onFrame(this.sim);
        this.lastRender = now;
        this.frames++; // fps counts frames drawn
      }
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

  /** Run the physics steps owed since the last frame (after a hold in `beforeStep`). */
  pump(): void {
    if (!this.paused) this.run();
  }

  private run(): void {
    const h = this.sim.timestep;
    let steps = 0;
    this.held = false;
    while (this.accum >= h && steps < MAX_STEPS_PER_FRAME) {
      if (this.beforeStep(this.sim) === false) {
        this.held = true;
        return; // held: keep the backlog
      }
      this.sim.step();
      this.accum -= h;
      this.simTimeWindow += h;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accum = 0; // drop the backlog
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
