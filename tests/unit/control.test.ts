/**
 * M4: the controller sandbox. The program runner (what runs inside the Web
 * Worker), the lockstep controller, the robot API against a compiled
 * template, and the example programs in the Sensor playground.
 * The worker itself and the watchdog are covered by tests/e2e/code.spec.ts.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { compile, ROBOT_BODY } from "../../src/robot/compile";
import { findPart } from "../../src/robot/parts";
import { templateSpec } from "../../src/robot/templates";
import { CONTROL_HZ, formatProgramError, MAX_LOG_LINES, type Reply, type TickMessage } from "../../src/control/api";
import { ProgramRunner } from "../../src/control/program";
import { locateSyntaxError } from "../../src/control/syntax";
import { Controller, readSensors, runInline, type Brain } from "../../src/control/controller";
import { EXAMPLES, findExample } from "../../src/control/examples";
import { LINE_RADIUS, PEN_HALF, SENSORS_XML } from "../../src/scenes/sensors";

let mj: Mujoco;
const sims: Sim[] = [];
const make = (xml: string) => {
  const s = new Sim(mj, xml);
  sims.push(s);
  return s;
};

beforeAll(async () => {
  mj = await loadEngine();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function pose(sim: Sim) {
  const id = sim.bodyId(ROBOT_BODY);
  const q = sim.data.xquat;
  return {
    x: sim.data.xpos[3 * id]!,
    y: sim.data.xpos[3 * id + 1]!,
    yaw: 2 * Math.atan2(q[4 * id + 3]!, q[4 * id]!),
  };
}

/** Feed a runner ticks by hand. */
function ticker(code: string, sensors: Record<string, number> = { distance: 0.5 }, runner = new ProgramRunner()) {
  let seq = 0;
  return (time = seq / CONTROL_HZ): Reply => {
    const msg: TickMessage = { type: "tick", seq: ++seq, time, sensors };
    if (seq === 1) msg.code = code;
    return runner.handle(msg);
  };
}

describe("program runner", () => {
  it("runs top-level code once and loop() on every tick, keeping state", () => {
    const tick = ticker(`
      let n = 0;
      console.log("setup");
      function loop() { n++; robot.setWheels(n / 10, -n / 10); console.log("tick", n, robot.time); }
    `);
    const first = tick(0);
    expect(first).toMatchObject({ type: "cmd", left: 0, right: 0, logs: ["setup"] });
    expect(tick(0.02)).toMatchObject({ type: "cmd", left: 0.1, right: -0.1, logs: ["tick 1 0.02"] });
    expect(tick(0.04)).toMatchObject({ type: "cmd", left: 0.2, right: -0.2, logs: ["tick 2 0.04"] });
  });

  it("works without a loop (setup only) and keeps the last command", () => {
    const tick = ticker("robot.setWheels(0.3, 0.4);");
    expect(tick()).toMatchObject({ left: 0.3, right: 0.4 });
    expect(tick()).toMatchObject({ left: 0.3, right: 0.4 });
  });

  it("clamps wheel speeds to [-1, 1]", () => {
    const tick = ticker("robot.setWheels(5, -7);");
    expect(tick()).toMatchObject({ left: 1, right: -1 });
  });

  it("reads sensors by name", () => {
    const tick = ticker('function loop() { robot.setWheels(robot.read("distance"), 0); }', { distance: 0.25 });
    tick();
    expect(tick()).toMatchObject({ left: 0.25 });
  });

  it("explains an unknown sensor, listing the robot's sensors, with the line number", () => {
    const tick = ticker('let x = 1;\nfunction loop() {\n  robot.read("lidar");\n}', { distance: 1, line_left: 0, line_right: 0 });
    tick();
    const r = tick();
    expect(r).toMatchObject({ type: "error", kind: "runtime", line: 3 });
    if (r.type !== "error") return;
    expect(r.message).toMatch(/no sensor called "lidar"/);
    expect(r.message).toMatch(/"distance", "line_left", "line_right"/);
  });

  it("says when a robot has no sensors", () => {
    const tick = ticker('robot.read("distance")', {});
    const r = tick();
    expect(r.type === "error" && r.message).toMatch(/no sensors/);
  });

  it("rejects bad wheel speeds with a helpful message and line number", () => {
    const r = ticker('\n\nrobot.setWheels("fast", 1);')();
    expect(r).toMatchObject({ type: "error", kind: "runtime", line: 3 });
    expect(r.type === "error" && r.message).toMatch(/needs two numbers from -1 to 1/);
    expect(ticker("robot.setWheels(NaN, 0)")().type).toBe("error");
    expect(ticker("robot.setWheels(1)")().type).toBe("error");
  });

  it("reports a thrown error's line inside loop()", () => {
    const tick = ticker("function loop() {\n  if (robot.time > 0.03) {\n    undefinedThing();\n  }\n}");
    expect(tick(0).type).toBe("cmd");
    expect(tick(0.02).type).toBe("cmd");
    const r = tick(0.04);
    expect(r).toMatchObject({ type: "error", kind: "runtime", line: 3 });
    expect(r.type === "error" && r.message).toMatch(/ReferenceError: undefinedThing is not defined/);
  });

  it("runs in strict mode (undeclared variables are errors)", () => {
    const r = ticker("speed = 3;")();
    expect(r).toMatchObject({ type: "error", line: 1 });
  });

  it("handles runaway recursion and odd throws", () => {
    const rec = ticker("function f() { return f() + 1; }\nf();")();
    expect(rec.type === "error" && rec.message).toMatch(/keeps calling itself/);
    const obj = ticker('throw { oops: 1 };')();
    expect(obj.type === "error" && obj.message).toMatch(/threw \{"oops":1\}/);
  });

  it("reports syntax errors, with the line from the parser", () => {
    const code = "function loop() {\n  robot.setWheels(1, 1;\n}";
    const plain = ticker(code)();
    expect(plain).toMatchObject({ type: "error", kind: "syntax" });
    const located = ticker(code, {}, new ProgramRunner(locateSyntaxError))();
    expect(located).toMatchObject({ type: "error", kind: "syntax", line: 2 });
    expect(located.type === "error" && formatProgramError(located)).toMatch(/^Line 2: This code can't be read: /);
    // Strict-mode-only syntax errors are located too.
    expect(locateSyntaxError("let a = 1;\nwith (a) {}")?.line).toBe(2);
    expect(locateSyntaxError("function loop() {}")).toBeNull();
  });

  it("stays stopped after an error", () => {
    const tick = ticker("function loop() { throw new Error('boom'); }");
    expect(tick().type).toBe("cmd");
    expect(tick()).toMatchObject({ type: "error", message: "boom" });
    expect(tick().type).toBe("error");
  });

  it("caps console output", () => {
    const tick = ticker(`for (let i = 0; i < 100; i++) console.log("x".repeat(1000), i);`);
    const r = tick();
    expect(r.logs).toHaveLength(MAX_LOG_LINES);
    for (const line of r.logs) expect(line.length).toBeLessThanOrEqual(200);
  });

  it("can't replace the robot API", () => {
    const r = ticker("robot.setWheels = () => {};")();
    expect(r.type).toBe("error"); // frozen object, strict mode
  });
});

/** A brain that answers only when told to, like a worker. */
class ManualBrain implements Brain {
  sent: TickMessage[] = [];
  disposed = false;
  private readonly runner = new ProgramRunner();
  controller: Controller | null = null;
  send(msg: TickMessage): void {
    this.sent.push(msg);
  }
  answer(): void {
    this.controller!.receive(this.runner.handle(this.sent[this.sent.length - 1]!));
  }
  dispose(): void {
    this.disposed = true;
  }
}

describe("lockstep controller", () => {
  const sensorBot = () => make(compile(templateSpec("sensor-bot")));

  it("holds physics until the program answers, then ticks every 1/50 s", () => {
    const sim = sensorBot();
    const brain = new ManualBrain();
    let resumed = 0;
    const ctl = new Controller(sim, "function loop() { robot.setWheels(1, 1); }", brain, {}, () => resumed++);
    brain.controller = ctl;

    expect(ctl.beforeStep()).toBe(false);
    expect(ctl.beforeStep()).toBe(false); // still waiting: no second message
    expect(brain.sent).toHaveLength(1);
    expect(brain.sent[0]!.code).toContain("loop");
    expect(brain.sent[0]!.sensors).toEqual(readSensors(sim));

    brain.answer();
    expect(resumed).toBe(1);
    const stepsPerTick = Math.round(1 / CONTROL_HZ / sim.timestep);
    for (let i = 0; i < stepsPerTick; i++) {
      expect(ctl.beforeStep()).toBe(true);
      sim.step();
    }
    expect(ctl.beforeStep()).toBe(false);
    expect(brain.sent).toHaveLength(2);
    expect(brain.sent[1]!.code).toBeUndefined();
    expect(brain.sent[1]!.time).toBeCloseTo(1 / CONTROL_HZ, 9);
    brain.answer();
    expect(ctl.wheels).toEqual({ left: 1, right: 1 });
    expect(ctl.beforeStep()).toBe(true);
    // Wheel command 1 = the motor's top speed.
    const top = findPart("motor", "motor_fast")!.maxSpeed;
    expect(sim.data.ctrl[sim.actuatorId("left")]).toBeCloseTo(top, 9);
    expect(sim.data.ctrl[sim.actuatorId("right")]).toBeCloseTo(top, 9);
  });

  it("ignores stale replies", () => {
    const sim = sensorBot();
    const brain = new ManualBrain();
    const ctl = new Controller(sim, "robot.setWheels(1, 1);", brain);
    brain.controller = ctl;
    ctl.beforeStep();
    ctl.receive({ type: "cmd", seq: 99, left: -1, right: -1, logs: [] });
    expect(ctl.beforeStep()).toBe(false);
    expect(ctl.wheels).toEqual({ left: 0, right: 0 });
  });

  it("a timeout fails the program, stops the wheels and disposes the brain", () => {
    const sim = sensorBot();
    const brain = new ManualBrain();
    const errors: string[] = [];
    let resumed = 0;
    const ctl = new Controller(sim, "", brain, { onError: (e) => errors.push(e.kind) }, () => resumed++);
    brain.controller = ctl;
    ctl.beforeStep();
    sim.data.ctrl[0] = 5;
    ctl.timeout("too slow");
    expect(ctl.state).toBe("failed");
    expect(ctl.error).toMatchObject({ kind: "timeout", message: "too slow" });
    expect(errors).toEqual(["timeout"]);
    expect(brain.disposed).toBe(true);
    expect(resumed).toBe(1);
    expect(sim.data.ctrl[0]).toBe(0);
    expect(ctl.beforeStep()).toBe(true); // physics carries on
    brain.answer(); // a late answer changes nothing
    expect(ctl.state).toBe("failed");
  });

  it("stop() stops the wheels and the brain", () => {
    const sim = sensorBot();
    const { controller } = runInline(sim, "robot.setWheels(1, -1);", 0.1);
    expect(sim.data.ctrl[sim.actuatorId("left")]).toBeGreaterThan(0);
    controller.stop();
    expect(controller.state).toBe("stopped");
    expect(sim.data.ctrl[sim.actuatorId("left")]).toBe(0);
    expect(sim.data.ctrl[sim.actuatorId("right")]).toBe(0);
  });

  it("uses the drive pad's default speed for unlimited wheel actuators", () => {
    const xml = compile(templateSpec("scout")).replace(/ ctrlrange="[^"]*"/g, "");
    const sim = make(xml);
    runInline(sim, "robot.setWheels(1, -0.5);", 0.05);
    expect(sim.data.ctrl[sim.actuatorId("left")]).toBe(10);
    expect(sim.data.ctrl[sim.actuatorId("right")]).toBe(-5);
  });
});

describe("robot API on a compiled template", () => {
  const sensorBot = () => make(compile(templateSpec("sensor-bot")));

  it("setWheels(1, 1) drives forward (+x), setWheels(-1, 1) spins left", () => {
    const fwd = sensorBot();
    const { controller } = runInline(fwd, "robot.setWheels(1, 1);", 1.5);
    expect(controller.state).toBe("running");
    const p = pose(fwd);
    expect(p.x).toBeGreaterThan(0.5);
    expect(Math.abs(p.y)).toBeLessThan(0.05);
    expect(fwd.instabilityCount()).toBe(0);

    const spin = sensorBot();
    runInline(spin, "robot.setWheels(-0.5, 0.5);", 0.3);
    const s = pose(spin);
    expect(s.yaw).toBeGreaterThan(0.3);
    expect(Math.hypot(s.x, s.y)).toBeLessThan(0.03);
  });

  it("read() gives the same values as the sim's sensors, and time counts control ticks", () => {
    const world = `<geom name="wall" type="box" size="0.05 1 0.1" pos="1.05 0 0.1"/>`;
    const sim = make(compile(templateSpec("sensor-bot"), { world }));
    const { controller, logs } = runInline(
      sim,
      `function loop() { if (Math.abs(robot.time - 1) < 1e-9) console.log(robot.read("distance"), robot.read("line_left"), robot.time); }`,
      1.1,
    );
    expect(controller.time).toBeCloseTo(1.1, 6);
    expect(logs).toHaveLength(1);
    const [d, line, t] = logs[0]!.split(" ").map(Number);
    expect(d).toBeGreaterThan(0.6);
    expect(d).toBeLessThan(1);
    expect(line).toBeGreaterThan(0.005);
    expect(t).toBe(1);
  });

  it("the same program gives the same trajectory (determinism)", () => {
    const code = findExample("avoid")!.code;
    const a = make(SENSORS_XML);
    const b = make(SENSORS_XML);
    runInline(a, code, 4);
    runInline(b, code, 4);
    expect(b.snapshotQpos()).toEqual(a.snapshotQpos());
  });
});

describe("example programs in the Sensor playground", () => {
  it("there are three, each with a loop()", () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(["square", "avoid", "follow"]);
    for (const e of EXAMPLES) expect(e.code).toMatch(/function loop\(\)/);
  });

  it("square: drives a square and comes back near the start, facing the same way", () => {
    const sim = make(SENSORS_XML);
    const start = pose(sim);
    let far = 0;
    const { controller } = runInline(sim, findExample("square")!.code, 0.02);
    for (let i = 0; i < Math.round(11 / sim.timestep); i++) {
      controller.beforeStep();
      sim.step();
      const p = pose(sim);
      far = Math.max(far, Math.hypot(p.x - start.x, p.y - start.y));
    }
    const end = pose(sim);
    expect(controller.state).toBe("running");
    expect(far).toBeGreaterThan(0.5); // it really went somewhere
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(0.15);
    const turned = Math.atan2(Math.sin(end.yaw - start.yaw), Math.cos(end.yaw - start.yaw));
    expect(Math.abs(turned)).toBeLessThan(0.3);
    expect(sim.instabilityCount()).toBe(0);
  });

  /** Smallest gap between any robot geom's bounding sphere and the pen walls. */
  function wallClearance(sim: Sim): number {
    const rover = sim.bodyId(ROBOT_BODY);
    let min = Infinity;
    for (let g = 0; g < sim.model.ngeom; g++) {
      const body = sim.model.geom_bodyid[g]!;
      if (body !== rover && sim.model.body_parentid[body] !== rover) continue;
      const r = sim.model.geom_rbound[g]!;
      const x = sim.data.geom_xpos[3 * g]!;
      const y = sim.data.geom_xpos[3 * g + 1]!;
      min = Math.min(min, PEN_HALF - Math.abs(x) - r, PEN_HALF - Math.abs(y) - r);
    }
    return min;
  }

  it("avoid: drives around for 30 s without touching a wall", () => {
    const sim = make(SENSORS_XML);
    const { controller } = runInline(sim, findExample("avoid")!.code, 0.02);
    let path = 0;
    let last = pose(sim);
    let clearance = Infinity;
    for (let i = 0; i < Math.round(30 / sim.timestep); i++) {
      controller.beforeStep();
      sim.step();
      const p = pose(sim);
      path += Math.hypot(p.x - last.x, p.y - last.y);
      last = p;
      clearance = Math.min(clearance, wallClearance(sim));
    }
    expect(controller.state).toBe("running");
    expect(path).toBeGreaterThan(5);
    expect(clearance).toBeGreaterThan(0);
    expect(sim.instabilityCount()).toBe(0);
  });

  it("follow: stays on the circular line for 20 s and nearly completes a lap", () => {
    const sim = make(SENSORS_XML);
    const { controller } = runInline(sim, findExample("follow")!.code, 0.02);
    let worst = 0;
    let angle = 0;
    let prev = Math.atan2(pose(sim).y, pose(sim).x);
    for (let i = 0; i < Math.round(20 / sim.timestep); i++) {
      controller.beforeStep();
      sim.step();
      const p = pose(sim);
      worst = Math.max(worst, Math.abs(Math.hypot(p.x, p.y) - LINE_RADIUS));
      const a = Math.atan2(p.y, p.x);
      angle += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
      prev = a;
    }
    expect(controller.state).toBe("running");
    expect(worst).toBeLessThan(0.04); // line probes are 4 cm either side of centre
    expect(angle).toBeGreaterThan(1.5 * Math.PI); // anticlockwise, most of a lap
    expect(sim.instabilityCount()).toBe(0);
  });
});

describe("replies from the worker are checked", () => {
  it("parseReply accepts good replies, clamps wheels and rejects malformed ones", async () => {
    const { parseReply } = await import("../../src/control/api");
    expect(parseReply({ type: "cmd", seq: 1, left: 0.5, right: 3, logs: [] })).toEqual({ type: "cmd", seq: 1, left: 0.5, right: 1, logs: [] });
    expect(parseReply({ type: "error", seq: 2, kind: "runtime", line: 3, message: "x", logs: ["a"] })).toMatchObject({ line: 3, message: "x" });
    expect(parseReply({ type: "error", seq: 2, kind: "evil", line: -4, logs: [] })).toMatchObject({ kind: "runtime", line: null });
    for (const bad of [null, 5, {}, { type: "cmd", seq: 1, left: NaN, right: 0, logs: [] }, { type: "cmd", seq: 1, left: 1e9 }, { type: "cmd", seq: 1, left: 0, right: 0, logs: [1] }, { type: "x", seq: 1, logs: [] }]) {
      expect(parseReply(bad)).toBeNull();
    }
  });

  it("a malformed reply fails the program and stops the wheels", () => {
    const sim = make(compile(templateSpec("sensor-bot")));
    const brain = new ManualBrain();
    const ctl = new Controller(sim, "", brain);
    brain.controller = ctl;
    ctl.beforeStep();
    ctl.receive({ type: "cmd", seq: 1, left: Infinity, right: 0, logs: [] });
    expect(ctl.state).toBe("failed");
    expect(sim.data.ctrl[sim.actuatorId("left")]).toBe(0);
    expect(brain.disposed).toBe(true);
  });
});
