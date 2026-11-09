/**
 * M5: environments. Each one compiles with every template and stays stable,
 * its goal can't be met by doing nothing, and its reference controller
 * (tests/envs/reference.ts) completes the goal within the time limit, so
 * every environment is known to be solvable. Node only, no browser.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { Controller, InlineBrain } from "../../src/control/controller";
import { ROBOT_BODY } from "../../src/robot/compile";
import { TEMPLATES, templateSpec } from "../../src/robot/templates";
import {
  DEFAULT_ENV_ID,
  ENVIRONMENTS,
  envScene,
  findEnv,
  GoalTracker,
  missingSensors,
  simView,
  type Environment,
  type EnvView,
  type TrackedStatus,
} from "../../src/envs";
import { distanceToTrack, trackPoints } from "../../src/envs/line";
import { BOX_BODY, RING_RADIUS } from "../../src/envs/sumo";
import { REFERENCES } from "../envs/reference";

let mj: Mujoco;
const sims: Sim[] = [];
beforeAll(async () => {
  mj = await loadEngine();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function load(env: Environment, template: string): Sim {
  const built = envScene(env, templateSpec(template));
  if (!built.ok) throw new Error(built.errors.join(" "));
  const sim = new Sim(mj, built.xml);
  sims.push(sim);
  return sim;
}

/** Run `code` in `env` until the goal ends (or `seconds` pass), checking the goal after every step. */
function attempt(env: Environment, template: string, code: string, seconds = env.timeLimit + 1) {
  const sim = load(env, template);
  const brain = new InlineBrain();
  const ctl = new Controller(sim, code, brain);
  brain.controller = ctl;
  const tracker = new GoalTracker(env);
  let status: TrackedStatus = tracker.status;
  const steps = Math.round(seconds / sim.timestep);
  for (let i = 0; i < steps && status.state === "running"; i++) {
    expect(ctl.beforeStep()).toBe(true);
    sim.step();
    status = tracker.update(simView(sim));
  }
  return { sim, ctl, status, tracker };
}

describe("environment registry", () => {
  it("has the four MVP environments with unique ids, and a default", () => {
    expect(ENVIRONMENTS.map((e) => e.id)).toEqual(["playground", "maze", "line", "sumo"]);
    expect(DEFAULT_ENV_ID).toBe("playground");
    expect(findEnv("maze").id).toBe("maze");
    expect(findEnv("nope").id).toBe("playground");
    expect(findEnv(null).id).toBe("playground");
    for (const e of ENVIRONMENTS) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.goal.length).toBeGreaterThan(0);
      expect(e.timeLimit).toBeGreaterThan(0);
      expect(TEMPLATES.some((t) => t.id === e.suggestedTemplate)).toBe(true);
    }
  });

  it("names the sensors a robot is missing for an environment", () => {
    expect(missingSensors(findEnv("maze"), templateSpec("hauler"))).toEqual(["distance"]);
    expect(missingSensors(findEnv("line"), templateSpec("scout"))).toEqual(["line"]);
    expect(missingSensors(findEnv("line"), templateSpec("sensor-bot"))).toEqual([]);
    expect(missingSensors(findEnv("sumo"), templateSpec("scout"))).toEqual([]);
  });

  it("keeps the robot's name as the model name", () => {
    const built = envScene(findEnv("maze"), { ...templateSpec("scout"), name: "Zoomy" });
    expect(built.ok && built.xml).toContain('<mujoco model="Zoomy">');
  });

  it("returns errors (never throws) for an invalid robot", () => {
    const built = envScene(findEnv("sumo"), { ...templateSpec("scout"), chassis: "nope" } as never);
    expect(built.ok).toBe(false);
  });
});

describe("every environment with every template", () => {
  for (const env of ENVIRONMENTS) {
    for (const t of TEMPLATES) {
      it(`${env.id} + ${t.id}: spawns at the start pose and stays stable for 3 s`, () => {
        const sim = load(env, t.id);
        sim.advance(3);
        expect(sim.instabilityCount()).toBe(0);
        expect(sim.hasInvalidState()).toBe(false);
        const [x, y, z] = simView(sim).body(ROBOT_BODY);
        expect(Math.hypot(x - env.start.x, y - env.start.y)).toBeLessThan(0.02);
        const id = sim.bodyId(ROBOT_BODY);
        const q = sim.data.xquat;
        const yaw = 2 * Math.atan2(q[4 * id + 3]!, q[4 * id]!);
        expect(Math.abs(Math.atan2(Math.sin(yaw - env.start.yaw), Math.cos(yaw - env.start.yaw)))).toBeLessThan(0.05);
        expect(z).toBeGreaterThan(0);
        expect(z).toBeLessThan(0.15);
      });
    }
  }
});

describe("goals aren't met by doing nothing", () => {
  for (const env of ENVIRONMENTS) {
    it(`${env.id}: a robot that sits still never starts the clock`, () => {
      const { status } = attempt(env, env.suggestedTemplate, "robot.setWheels(0, 0);");
      expect(status).toMatchObject({ state: "running", started: false, remaining: env.timeLimit });
    });

    it(`${env.id}: a robot that only creeps forward fails when time runs out`, () => {
      const { status } = attempt(env, env.suggestedTemplate, "robot.setWheels(0.02, 0.02);", 3 * env.timeLimit);
      expect(status.state).toBe("fail");
      expect(status.message).toMatch(/Time's up/);
      expect(status.time).toBeGreaterThanOrEqual(env.timeLimit);
    });
  }

  it("maze: driving straight ahead hits the wall and doesn't escape", () => {
    const { status, sim } = attempt(findEnv("maze"), "sensor-bot", "robot.setWheels(1, 1);", 20);
    expect(status.state).toBe("running");
    expect(simView(sim).body(ROBOT_BODY)[0]).toBeLessThan(1.2);
  });

  it("line: driving straight off the line fails", () => {
    const { status } = attempt(findEnv("line"), "sensor-bot", "robot.setWheels(0.5, 0.3);");
    expect(status.state).toBe("fail");
    expect(status.message).toMatch(/Off the track/);
  });

  it("sumo: leaving the ring without the box fails", () => {
    const { status, sim } = attempt(findEnv("sumo"), "hauler", "robot.setWheels(-1, -1);");
    expect(status.state).toBe("fail");
    expect(status.message).toMatch(/left the ring/);
    const [bx, by] = simView(sim).body(BOX_BODY);
    expect(Math.hypot(bx, by)).toBeLessThan(RING_RADIUS);
  });
});

describe("reference controllers solve every environment", () => {
  it("there is one for every environment", () => {
    expect(REFERENCES.map((r) => r.env).sort()).toEqual(ENVIRONMENTS.map((e) => e.id).sort());
  });

  for (const ref of REFERENCES) {
    it(`${ref.env}: the reference controller (${ref.template}) completes the goal`, () => {
      const env = findEnv(ref.env);
      expect(missingSensors(env, templateSpec(ref.template))).toEqual([]);
      const { status, ctl, sim } = attempt(env, ref.template, ref.code);
      expect(ctl.error).toBeNull();
      expect(status.state, status.message).toBe("success");
      expect(status.time).toBeLessThan(env.timeLimit);
      expect(sim.instabilityCount()).toBe(0);
    });
  }

  it("runs are deterministic: the same controller finishes at the same time", () => {
    const ref = REFERENCES.find((r) => r.env === "maze")!;
    const a = attempt(findEnv("maze"), ref.template, ref.code).status.time;
    const b = attempt(findEnv("maze"), ref.template, ref.code).status.time;
    expect(a).toBe(b);
  });
});

describe("goal tracker", () => {
  const fake = (state: "running" | "success" | "fail"): Environment => ({
    ...findEnv("playground"),
    timeLimit: 10,
    createGoal: () => ({ update: (v: EnvView) => ({ state: v.time >= 5 ? state : "running", message: state }) }),
  });
  /** The robot sits at the origin until `moveAt`, then is 1 m away. */
  const at = (time: number, moveAt = 1): EnvView => ({ time, body: () => (time >= moveAt ? [1, 0, 0] : [0, 0, 0]) });

  it("waits for the robot to move before starting the clock", () => {
    const tr = new GoalTracker(fake("running"));
    expect(tr.update(at(0))).toMatchObject({ state: "running", started: false, remaining: 10 });
    expect(tr.update(at(0.5))).toMatchObject({ state: "running", started: false, remaining: 10 });
    // Minutes spent writing a program don't count.
    expect(tr.update(at(300, 400))).toMatchObject({ state: "running", started: false, remaining: 10 });
    expect(tr.update(at(400, 400))).toMatchObject({ state: "running", started: true, time: 0, remaining: 10 });
    expect(tr.update(at(409.9, 400)).state).toBe("running");
    expect(tr.update(at(410, 400))).toMatchObject({ state: "fail", time: 10 });
  });

  it("counts down while running, then latches the first result", () => {
    const tr = new GoalTracker(fake("success"));
    tr.update(at(0));
    expect({ ...tr.update(at(2)) }).toMatchObject({ state: "running", started: true, time: 0, remaining: 10 });
    expect({ ...tr.update(at(3)) }).toMatchObject({ state: "running", time: 1, remaining: 9 });
    expect(tr.update(at(5))).toMatchObject({ state: "success", time: 3, remaining: 0 });
    expect(tr.update(at(20))).toMatchObject({ state: "success", time: 3 });
  });

  it("fails when time runs out", () => {
    const tr = new GoalTracker(fake("running"));
    tr.update(at(0));
    tr.update(at(1));
    tr.update(at(10.9));
    expect(tr.update(at(11))).toMatchObject({ state: "fail", message: expect.stringMatching(/Time's up/) });
  });

  it("starts a fresh attempt when time goes back (Reset or Run), or on restart()", () => {
    let made = 0;
    const env = { ...fake("fail"), createGoal: () => (made++, fake("fail").createGoal()) };
    const tr = new GoalTracker(env);
    tr.update(at(0));
    expect(tr.update(at(6)).state).toBe("fail");
    expect(tr.update(at(0.002))).toMatchObject({ state: "running", started: false, remaining: 10 });
    expect(made).toBe(2);
    tr.update(at(6));
    tr.restart();
    expect(tr.status).toMatchObject({ state: "running", started: false });
    expect(made).toBe(3);
  });
});

describe("line track geometry", () => {
  it("every point of the drawn line is on the track", () => {
    for (const [x, y] of trackPoints()) expect(distanceToTrack(x, y)).toBeLessThan(1e-9);
    expect(distanceToTrack(0, 0)).toBeCloseTo(0.6, 9);
  });
});
