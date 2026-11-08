/**
 * M4 stretch goal: Python controller programs (Pyodide). The Python runner
 * against real Pyodide loaded in Node, the robot API from Python, and the
 * Python versions of the example programs, which must drive exactly like
 * the JavaScript ones. The Python worker itself, its lazy loading and the
 * watchdog are covered by tests/e2e/python.spec.ts.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { compile } from "../../src/robot/compile";
import { templateSpec } from "../../src/robot/templates";
import { CONTROL_HZ, MAX_LOG_CHARS, MAX_LOG_LINES, type Reply, type TickMessage } from "../../src/control/api";
import { PythonRunner, type PythonRuntime } from "../../src/control/python";
import { runInline } from "../../src/control/controller";
import { EXAMPLES } from "../../src/control/examples";
import { SENSORS_XML } from "../../src/scenes/sensors";
import { PYODIDE_FILES } from "../../vite.config";

let mj: Mujoco;
let py: PythonRuntime;
const sims: Sim[] = [];
const make = (xml: string) => {
  const s = new Sim(mj, xml);
  sims.push(s);
  return s;
};

beforeAll(async () => {
  const [engine, pyodide] = await Promise.all([loadEngine(), loadPyodide()]);
  mj = engine;
  // PyProxy's typings don't declare `get`, but Pyodide's globals (a Python dict) have it.
  py = pyodide as unknown as PythonRuntime;
}, 60_000);
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

/** Feed a fresh Python runner ticks by hand. */
function ticker(code: string, sensors: Record<string, number> = { distance: 0.5 }) {
  const runner = new PythonRunner(py);
  let seq = 0;
  return (time = seq / CONTROL_HZ): Reply => {
    const msg: TickMessage = { type: "tick", seq: ++seq, time, sensors };
    if (seq === 1) msg.code = code;
    return runner.handle(msg);
  };
}

describe("python runner", () => {
  it("runs top-level code once and loop() on every tick, keeping state", () => {
    const tick = ticker(
      [
        "n = 0",
        'print("setup")',
        "def loop():",
        "    global n",
        "    n += 1",
        "    robot.set_wheels(n / 10, -n / 10)",
        '    print("tick", n, robot.time)',
      ].join("\n"),
    );
    expect(tick(0)).toEqual({ type: "cmd", seq: 1, left: 0, right: 0, logs: ["setup"] });
    expect(tick(0.02)).toEqual({ type: "cmd", seq: 2, left: 0.1, right: -0.1, logs: ["tick 1 0.02"] });
    expect(tick(0.04)).toMatchObject({ left: 0.2, right: -0.2, logs: ["tick 2 0.04"] });
  });

  it("setWheels works too, wheels are clamped and stick between ticks", () => {
    const tick = ticker("robot.setWheels(3, -7)");
    expect(tick()).toMatchObject({ type: "cmd", left: 1, right: -1 });
    expect(tick()).toMatchObject({ type: "cmd", left: 1, right: -1 });
  });

  it("read() gives sensor values; time is what the page sent", () => {
    const tick = ticker("def loop():\n    print(robot.read('distance'), robot.time)", { distance: 0.25 });
    tick(0);
    expect(tick(1.5)).toMatchObject({ logs: ["0.25 1.5"] });
  });

  it("gives syntax errors with their line", () => {
    const r = ticker("x = 1\ndef loop(:\n    pass")();
    expect(r).toMatchObject({ type: "error", kind: "syntax", line: 2 });
    expect((r as { message: string }).message).toMatch(/^This code can't be read/);
    expect(ticker("def loop():\nrobot.set_wheels(1, 1)")()).toMatchObject({ type: "error", kind: "syntax", line: 2 });
  });

  it("gives runtime errors with the line in the user's code, then stays stopped", () => {
    const tick = ticker("def helper():\n    return 1 / 0\n\ndef loop():\n    if robot.time > 0.03:\n        helper()\n");
    expect(tick(0)).toMatchObject({ type: "cmd" });
    expect(tick(0.02)).toMatchObject({ type: "cmd" });
    const r = tick(0.04);
    expect(r).toMatchObject({ type: "error", kind: "runtime", line: 2, message: "ZeroDivisionError: division by zero" });
    expect(tick(0.06)).toMatchObject({ type: "error", message: "The program has stopped." });
  });

  it("explains API misuse in plain words, at the calling line", () => {
    const bad = ticker("\nrobot.set_wheels('fast', 1)")();
    expect(bad).toMatchObject({ type: "error", line: 2 });
    expect((bad as { message: string }).message).toMatch(/needs two numbers from -1 to 1.*It got \('fast', 1\)/);
    for (const v of ["True", "float('nan')", "None"]) {
      expect(ticker(`robot.set_wheels(${v}, 0)`)()).toMatchObject({ type: "error", line: 1 });
    }
    const sensor = ticker("robot.read('nope')", { distance: 1, line_left: 0 })();
    expect((sensor as { message: string }).message).toBe(`There's no sensor called 'nope'. This robot has: "distance", "line_left".`);
    const none = ticker("robot.read('distance')", {})();
    expect((none as { message: string }).message).toMatch(/has no sensors/);
  });

  it("the robot can't be broken by assigning to it", () => {
    expect(ticker("robot.time = 5")()).toMatchObject({ type: "error", line: 1 });
    expect(ticker("robot.speed = 5")()).toMatchObject({ type: "error", line: 1 });
  });

  it("reports recursion, exit() and errors with no message plainly", () => {
    expect(ticker("def f():\n    return f()\nf()")()).toMatchObject({ type: "error", message: expect.stringMatching(/calling itself/) });
    expect(ticker("exit()")()).toMatchObject({ type: "error", message: "The program called exit()." });
    expect(ticker("raise ValueError")()).toMatchObject({ type: "error", message: "ValueError", line: 1 });
  });

  it("limits print output per tick, line length, and keeps print(end='') text", () => {
    const flood = ticker("for i in range(100):\n    print(i)")();
    expect(flood.logs).toHaveLength(MAX_LOG_LINES);
    const long = ticker("print('x' * 1000)")();
    expect(long.logs[0]!.length).toBe(MAX_LOG_CHARS);
    expect(ticker("print('a', end='')\nprint('b', 2, sep='-', end='')")().logs).toEqual(["ab-2"]);
  });

  it("wheel values set behind the API's back can't break the reply", () => {
    const r = ticker("robot.set_wheels.__globals__['_st']['left'] = float('nan')\nrobot.set_wheels.__globals__['_st']['right'] = 9")();
    expect(r).toMatchObject({ type: "cmd", left: 0, right: 0 });
  });

  it("each runner starts fresh: nothing leaks from the last program", () => {
    ticker("x = 5\nrobot.set_wheels(1, 1)\ndef loop():\n    pass")();
    const r = ticker("print('x' in globals())")();
    expect(r).toMatchObject({ type: "cmd", left: 0, right: 0, logs: ["False"] });
  });
});

describe("python examples drive like the javascript ones", () => {
  const sensorBot = () => make(compile(templateSpec("sensor-bot")));

  it("set_wheels(1, 1) drives forward (+x)", () => {
    const sim = sensorBot();
    const { controller } = runInline(sim, "robot.set_wheels(1, 1)", 1.5, new PythonRunner(py));
    expect(controller.state).toBe("running");
    expect(sim.data.xpos[3 * sim.bodyId("rover")]).toBeGreaterThan(0.5);
    expect(sim.instabilityCount()).toBe(0);
  });

  for (const ex of EXAMPLES) {
    it(`${ex.id}: the Python example gives the same trajectory as the JavaScript one`, () => {
      const js = make(SENSORS_XML);
      const pyth = make(SENSORS_XML);
      const seconds = ex.id === "square" ? 11 : 8;
      const a = runInline(js, ex.code, seconds);
      const b = runInline(pyth, ex.python, seconds, new PythonRunner(py));
      expect(b.controller.state, b.controller.error?.message).toBe("running");
      expect(a.controller.state).toBe("running");
      expect(pyth.snapshotQpos()).toEqual(js.snapshotQpos());
      expect(pyth.instabilityCount()).toBe(0);
    });
  }
});

describe("pyodide files", () => {
  it("the files served for Python are the ones the installed Pyodide needs", () => {
    const pkg = JSON.parse(readFileSync("node_modules/pyodide/package.json", "utf8")) as { version: string };
    const lock = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(lock.dependencies.pyodide).toBe(pkg.version); // pinned: the worker and the files must match
    for (const f of PYODIDE_FILES) expect(() => readFileSync(`node_modules/pyodide/${f}`)).not.toThrow();
  });

  it("nothing imports Pyodide or the Python worker eagerly", () => {
    for (const f of ["src/main.ts", "src/ui/codePanel.ts", "src/control/host.ts", "src/control/python.ts", "src/control/controller.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']pyodide["']/);
    }
  });
});
