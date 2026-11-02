/**
 * Physics checks for the Milestone 0 hello scene, run in Node (no browser).
 *
 * PROTECTED: agents must not weaken these assertions or golden values to make
 * a change pass. If a value genuinely needs to change, explain why in the PR.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { HELLO_XML } from "../../src/scenes/hello";
import { wheelSpeeds } from "../../src/app/drive";

let mj: Mujoco;
const sims: Sim[] = [];
const make = () => {
  const s = new Sim(mj, HELLO_XML);
  sims.push(s);
  return s;
};

const bodyPos = (sim: Sim, name: string) => {
  const id = sim.model.body(name).id;
  const p = sim.data.xpos;
  return { x: p[3 * id]!, y: p[3 * id + 1]!, z: p[3 * id + 2]! };
};

const drive = (sim: Sim, forward: number, turn: number, seconds: number) => {
  const l = sim.model.actuator("left").id;
  const r = sim.model.actuator("right").id;
  const { left, right } = wheelSpeeds({ forward, turn }, 10);
  const steps = Math.round(seconds / sim.timestep);
  for (let i = 0; i < steps; i++) {
    sim.data.ctrl[l] = left;
    sim.data.ctrl[r] = right;
    sim.step();
  }
};

beforeAll(async () => {
  mj = await loadEngine();
});

afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

describe("hello scene", () => {
  it("compiles and has the expected structure", () => {
    const sim = make();
    expect(sim.model.nu).toBe(2);
    expect(sim.timestep).toBeCloseTo(0.002);
    expect(sim.geoms().length).toBeGreaterThanOrEqual(8);
  });

  it("objects fall and come to rest on the floor (sanity)", () => {
    const sim = make();
    sim.advance(3);
    expect(sim.hasInvalidState()).toBe(false);
    expect(sim.instabilityCount()).toBe(0);
    // Resting heights ~= half extents above the floor.
    expect(bodyPos(sim, "ball").z).toBeCloseTo(0.1, 2);
    expect(bodyPos(sim, "box").z).toBeCloseTo(0.12, 2);
    expect(bodyPos(sim, "capsule").z).toBeCloseTo(0.06, 2);
    // Everything is at rest: no runaway velocities.
    const maxVel = Math.max(...Array.from(sim.data.qvel, Math.abs));
    expect(maxVel).toBeLessThan(0.05);
  });

  it("an idle rover stays put", () => {
    const sim = make();
    const start = bodyPos(sim, "rover");
    sim.advance(3);
    const end = bodyPos(sim, "rover");
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.02);
  });

  it("is deterministic: identical inputs give identical state", () => {
    const a = make();
    const b = make();
    drive(a, 1, 0.3, 2);
    drive(b, 1, 0.3, 2);
    expect(a.snapshotQpos()).toEqual(b.snapshotQpos());
  });

  it("reset restores the initial state", () => {
    const sim = make();
    const initial = sim.snapshotQpos();
    sim.advance(1);
    sim.reset();
    expect(sim.snapshotQpos()).toEqual(initial);
    expect(sim.time).toBe(0);
  });
});

describe("rover driving", () => {
  it("forward command moves the rover forward (+x) in a straight line", () => {
    const sim = make();
    drive(sim, 1, 0, 2);
    const p = bodyPos(sim, "rover");
    expect(p.x).toBeGreaterThan(0.5);
    expect(Math.abs(p.y)).toBeLessThan(0.1);
    expect(sim.hasInvalidState()).toBe(false);
  });

  it("reverse command moves the rover backward (-x)", () => {
    const sim = make();
    drive(sim, -1, 0, 2);
    expect(bodyPos(sim, "rover").x).toBeLessThan(-0.5);
  });

  it("turn-left command spins counter-clockwise (+yaw)", () => {
    const sim = make();
    drive(sim, 0, 1, 1);
    const id = sim.model.body("rover").id;
    const q = sim.data.xquat; // w x y z
    const [w, x, y, z] = [q[4 * id]!, q[4 * id + 1]!, q[4 * id + 2]!, q[4 * id + 3]!];
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    expect(yaw).toBeGreaterThan(0.3);
  });
});

describe("wheelSpeeds", () => {
  it("maps forward/turn to differential wheel speeds and clamps", () => {
    expect(wheelSpeeds({ forward: 1, turn: 0 }, 10)).toEqual({ left: 10, right: 10 });
    expect(wheelSpeeds({ forward: 0, turn: 1 }, 10)).toEqual({ left: -10, right: 10 });
    expect(wheelSpeeds({ forward: 1, turn: 1 }, 10)).toEqual({ left: 0, right: 10 });
  });
});
