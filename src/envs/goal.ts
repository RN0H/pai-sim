/**
 * Runs an environment's goal against the simulation: latches the first
 * success or failure, applies the time limit, and starts a fresh attempt
 * whenever simulated time goes backwards (Reset, Run). Pure.
 *
 * The clock starts when the robot first moves away from where it spawned,
 * so time spent reading the goal or writing a program doesn't count.
 */
import type { EnvView, Environment, Goal, GoalStatus } from "./types";

/** How far (m) the robot must move from its spawn point to start the clock. */
export const START_DISTANCE = 0.02;

export interface TrackedStatus extends GoalStatus {
  /** Whether the clock has started (the robot has moved). */
  started: boolean;
  /** Seconds since the clock started (when the attempt ended, once it has). */
  time: number;
  /** Seconds left (0 once ended). */
  remaining: number;
}

export class GoalTracker {
  private goal: Goal;
  private lastTime = -1;
  private spawn: [number, number] | null = null;
  private startTime: number | null = null;
  private ended = false;
  private current: TrackedStatus;

  constructor(
    readonly env: Environment,
    /** The robot's body name. */
    private readonly robot = "rover",
  ) {
    this.goal = env.createGoal();
    this.current = this.waiting();
  }

  /** The current status. While running it is updated in place: copy it to keep it. */
  get status(): TrackedStatus {
    return this.current;
  }

  /** Start a fresh attempt. */
  restart(): void {
    this.goal = this.env.createGoal();
    this.ended = false;
    this.lastTime = -1;
    this.spawn = null;
    this.startTime = null;
    this.current = this.waiting();
  }

  /** Call after every physics step. */
  update(view: EnvView): TrackedStatus {
    const t = view.time;
    if (t < this.lastTime) this.restart();
    if (t === this.lastTime || this.ended) return this.current;
    this.lastTime = t;
    if (this.startTime === null) {
      const [x, y] = view.body(this.robot);
      if (this.spawn === null) this.spawn = [x, y];
      if (Math.hypot(x - this.spawn[0], y - this.spawn[1]) < START_DISTANCE) return this.current;
      this.startTime = t;
    }
    const elapsed = t - this.startTime;
    const s = this.goal.update(view);
    if (s.state !== "running") {
      this.ended = true;
      this.current = { ...s, started: true, time: elapsed, remaining: 0 };
    } else if (elapsed >= this.env.timeLimit) {
      this.ended = true;
      this.current = { state: "fail", message: "Time's up! Press Reset to try again.", started: true, time: elapsed, remaining: 0 };
    } else {
      // Updated in place: this runs every physics step, so no garbage.
      const c = this.current;
      c.message = s.message;
      c.started = true;
      c.time = elapsed;
      c.remaining = this.env.timeLimit - elapsed;
    }
    return this.current;
  }

  private waiting(): TrackedStatus {
    return { state: "running", message: this.env.goal, started: false, time: 0, remaining: this.env.timeLimit };
  }
}
