/**
 * The environments, in picker order (the first is the default), and how to
 * put a robot into one. Pure: no DOM.
 */
import { tryCompile } from "../robot/compile";
import type { RobotSpec } from "../robot/spec";
import type { Sim } from "../physics/engine";
import { PLAYGROUND } from "./playground";
import { MAZE } from "./maze";
import { LINE_TRACK } from "./line";
import { SUMO } from "./sumo";
import type { Environment, EnvView } from "./types";

export type { Environment, EnvView, Goal, GoalState, GoalStatus } from "./types";
export { GoalTracker, type TrackedStatus } from "./goal";

export const ENVIRONMENTS: readonly Environment[] = [PLAYGROUND, MAZE, LINE_TRACK, SUMO];

export const DEFAULT_ENV_ID = ENVIRONMENTS[0]!.id;

/** Look up an environment; unknown or missing ids give the default. */
export function findEnv(id: string | null | undefined): Environment {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0]!;
}

/**
 * Compile `spec` into `env`, spawned at the environment's start pose. The
 * model keeps the robot's name. Never throws; invalid specs give errors.
 */
export function envScene(env: Environment, spec: RobotSpec): ReturnType<typeof tryCompile> {
  return tryCompile(spec, { pose: env.start, world: env.world, floor: true });
}

/** Sensors the environment needs that the robot doesn't have. */
export function missingSensors(env: Environment, spec: RobotSpec): string[] {
  return env.needs.filter((s) => !spec.sensors.includes(s));
}

/** A goal's view of a running Sim (reads live state; body ids are looked up once). */
export function simView(sim: Sim): EnvView {
  const ids = new Map<string, number>();
  return {
    get time() {
      return sim.time;
    },
    body(name) {
      let id = ids.get(name);
      if (id === undefined) ids.set(name, (id = sim.bodyId(name)));
      if (id < 0) throw new Error(`no body named "${name}"`);
      const p = sim.data.xpos;
      return [p[3 * id]!, p[3 * id + 1]!, p[3 * id + 2]!];
    },
  };
}
