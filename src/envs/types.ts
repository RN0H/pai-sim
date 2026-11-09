/**
 * Environments as data: where the robot starts, what's in the world, and
 * what counts as winning. Pure: no DOM, no MuJoCo, so goals are unit-tested
 * in Node and the same code runs in the page.
 */
import type { Pose } from "../robot/compile";
import type { SensorId } from "../robot/parts";

/** What a goal can see of the running simulation. */
export interface EnvView {
  /** Simulated seconds since the scene (or program) started. */
  time: number;
  /** World position [x, y, z] of a body by name (MuJoCo z-up). Throws for an unknown body. */
  body(name: string): [number, number, number];
}

export type GoalState = "running" | "success" | "fail";

export interface GoalStatus {
  state: GoalState;
  /** Plain-language line for the banner. */
  message: string;
}

/**
 * One attempt at an environment's goal. Fresh for every run; `update` is
 * called after every physics step with time going forward, and decides
 * success or failure (the time limit is handled by `GoalTracker`).
 */
export interface Goal {
  update(view: EnvView): GoalStatus;
}

export interface Environment {
  /** Stable id used in `?env=<id>` URLs (and M6 share links). */
  id: string;
  /** Label in the environment picker. */
  name: string;
  /** The goal in one short sentence, shown while running. */
  goal: string;
  /** Seconds allowed before the attempt fails. */
  timeLimit: number;
  /** Where the robot spawns. */
  start: Pose;
  /** MJCF for inside `<worldbody>` (walls, lines, props). Trusted. */
  world: string;
  /** Sensors a robot needs to have a fair chance (shown as a tip when missing). */
  needs: readonly SensorId[];
  /** Template to suggest for this environment. */
  suggestedTemplate: string;
  createGoal(): Goal;
}
