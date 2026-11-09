/**
 * Runs an environment's goal against the simulation: latches the first
 * success or failure, applies the time limit, and starts a fresh attempt
 * whenever simulated time goes backwards (Reset, Run). Pure.
 */
import type { EnvView, Environment, Goal, GoalStatus } from "./types";

export interface TrackedStatus extends GoalStatus {
  /** Simulated time when the attempt ended (or now, while running). */
  time: number;
  /** Seconds left (0 once ended). */
  remaining: number;
}

export class GoalTracker {
  private goal: Goal;
  private lastTime = -1;
  private ended: TrackedStatus | null = null;
  private current: TrackedStatus;

  constructor(readonly env: Environment) {
    this.goal = env.createGoal();
    this.current = this.running(0);
  }

  get status(): TrackedStatus {
    return this.current;
  }

  /** Start a fresh attempt. */
  restart(): void {
    this.goal = this.env.createGoal();
    this.ended = null;
    this.lastTime = -1;
    this.current = this.running(0);
  }

  /** Call after every physics step. */
  update(view: EnvView): TrackedStatus {
    const t = view.time;
    if (t < this.lastTime) this.restart();
    if (t === this.lastTime) return this.current;
    this.lastTime = t;
    if (this.ended) return this.current;
    const s = this.goal.update(view);
    if (s.state !== "running") {
      this.ended = { ...s, time: t, remaining: 0 };
      this.current = this.ended;
    } else if (t >= this.env.timeLimit) {
      this.ended = { state: "fail", message: "Time's up! Press Reset to try again.", time: t, remaining: 0 };
      this.current = this.ended;
    } else {
      this.current = { ...s, time: t, remaining: this.env.timeLimit - t };
    }
    return this.current;
  }

  private running(t: number): TrackedStatus {
    return { state: "running", message: this.env.goal, time: t, remaining: this.env.timeLimit - t };
  }
}
