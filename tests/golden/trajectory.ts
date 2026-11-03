/**
 * The scripted drive used for golden trajectories: shared by the generator
 * (scripts/golden.mjs) and the check (tests/unit/golden.test.ts) so both
 * replay exactly the same inputs.
 */
import { Sim, type Mujoco } from "../../src/physics/engine";
import { compile, ROBOT_BODY } from "../../src/robot/compile";
import type { RobotSpec } from "../../src/robot/spec";

/** Commands as fractions of the motor's top speed: [seconds, left, right]. */
export const SCRIPT: readonly [number, number, number][] = [
  [0.5, 0, 0], // settle
  [1.5, 1, 1], // straight ahead
  [1.0, -0.5, 0.5], // spin left
  [1.5, 1, 0.6], // curve right
  [1.0, -1, -1], // reverse
  [0.5, 0, 0], // stop
];
/** Sample every this many seconds. */
export const SAMPLE_EVERY = 0.25;

/** One sample: time, position x/y/z of the robot body, and heading (yaw). */
export type Sample = [t: number, x: number, y: number, z: number, yaw: number];

export function trajectory(mj: Mujoco, spec: RobotSpec): Sample[] {
  const sim = new Sim(mj, compile(spec));
  try {
    const l = sim.actuatorId("left");
    const r = sim.actuatorId("right");
    const top = sim.model.actuator_ctrlrange[2 * l + 1]!;
    const id = sim.bodyId(ROBOT_BODY);
    const every = Math.round(SAMPLE_EVERY / sim.timestep);
    const out: Sample[] = [];
    let step = 0;
    const sample = () => {
      const p = sim.data.xpos;
      const q = sim.data.xquat;
      const [w, x, y, z] = [q[4 * id]!, q[4 * id + 1]!, q[4 * id + 2]!, q[4 * id + 3]!];
      const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
      const round = (v: number) => Number(v.toFixed(6));
      out.push([round(sim.time), round(p[3 * id]!), round(p[3 * id + 1]!), round(p[3 * id + 2]!), round(yaw)]);
    };
    sample();
    for (const [seconds, left, right] of SCRIPT) {
      const n = Math.round(seconds / sim.timestep);
      for (let i = 0; i < n; i++) {
        sim.data.ctrl[l] = left * top;
        sim.data.ctrl[r] = right * top;
        sim.step();
        if (++step % every === 0) sample();
      }
    }
    if (sim.instabilityCount() > 0 || sim.hasInvalidState()) throw new Error(`${spec.name} became unstable`);
    return out;
  } finally {
    sim.dispose();
  }
}
