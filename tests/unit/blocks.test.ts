/**
 * M4: the blocks editor's code generator (src/control/blocks.ts), run
 * headless in Node. Blocks must make the same kind of program people write
 * by hand, and the block versions of the examples must drive exactly like
 * the code versions (whose effects tests/unit/control.test.ts checks).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadEngine, Sim, type Mujoco } from "../../src/physics/engine";
import { BLOCK_EXAMPLES, BLOCKS_HEADER, blocksToCode, LOOP_BLOCK, START_BLOCK, STARTER_BLOCKS, TOOLBOX } from "../../src/control/blocks";
import { EXAMPLES, findExample } from "../../src/control/examples";
import { runInline } from "../../src/control/controller";
import { ProgramRunner } from "../../src/control/program";
import { CONTROL_HZ, type Reply } from "../../src/control/api";
import { SENSORS_XML } from "../../src/scenes/sensors";

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

type Json = Record<string, unknown>;
const ws = (blocks: Json[], variables: { name: string; id: string }[] = []) => ({
  blocks: { languageVersion: 0, blocks },
  variables,
});
const wheels = (l: number, r: number, next?: Json): Json => ({
  type: "robot_set_wheels",
  inputs: { LEFT: { block: { type: "math_number", fields: { NUM: l } } }, RIGHT: { block: { type: "math_number", fields: { NUM: r } } } },
  ...(next ? { next: { block: next } } : {}),
});
const print = (text: string, next?: Json): Json => ({
  type: "text_print",
  inputs: { TEXT: { block: { type: "text", fields: { TEXT: text } } } },
  ...(next ? { next: { block: next } } : {}),
});
const hat = (type: string, y: number, first?: Json): Json => ({ type, x: 0, y, ...(first ? { inputs: { DO: { block: first } } } : {}) });

/** Run a program for `ticks` control ticks with fixed sensor values; collect replies. */
function runTicks(code: string, ticks: number, sensors: Record<string, number> = { distance: 0.5 }): Reply[] {
  const runner = new ProgramRunner();
  const out: Reply[] = [];
  for (let seq = 1; seq <= ticks; seq++) {
    out.push(runner.handle({ type: "tick", seq, time: (seq - 1) / CONTROL_HZ, sensors, ...(seq === 1 ? { code } : {}) }));
  }
  return out;
}

describe("code from blocks", () => {
  it("the starter blocks make the starter program: a loop() that drives at half speed", () => {
    const code = blocksToCode(STARTER_BLOCKS);
    expect(code.startsWith(BLOCKS_HEADER)).toBe(true);
    expect(code).toContain("function loop() {\n  robot.setWheels(0.5, 0.5);\n}");
    const replies = runTicks(code, 3);
    expect(replies.at(-1)).toMatchObject({ type: "cmd", left: 0.5, right: 0.5 });
  });

  it("'when the program starts' runs once, 'every tick' runs every tick, loose blocks never run", () => {
    const code = blocksToCode(
      ws([
        hat(START_BLOCK, 0, print("start")),
        hat(LOOP_BLOCK, 100, print("tick")),
        { ...print("loose"), x: 300, y: 0 }, // not inside a hat
      ]),
    );
    expect(code).not.toContain("loose");
    const logs = runTicks(code, 3).flatMap((r) => (r.type === "cmd" ? r.logs ?? [] : []));
    expect(logs).toEqual(["start", "tick", "tick"]);
  });

  it("several 'every tick' blocks run in order, top to bottom, in one loop()", () => {
    const code = blocksToCode(ws([hat(LOOP_BLOCK, 200, print("second")), hat(LOOP_BLOCK, 0, print("first"))]));
    expect(code.match(/function loop\(\)/g)).toHaveLength(1);
    const logs = runTicks(code, 2).flatMap((r) => (r.type === "cmd" ? r.logs ?? [] : []));
    expect(logs).toEqual(["first", "second"]);
  });

  it("an empty workspace makes a program that runs and does nothing", () => {
    const code = blocksToCode(ws([]));
    expect(code).toBe(BLOCKS_HEADER);
    expect(runTicks(code, 2).at(-1)).toMatchObject({ type: "cmd", left: 0, right: 0 });
  });

  it("variables called robot, console or loop don't break the program", () => {
    const vars = ["robot", "console", "loop"].map((name) => ({ name, id: name }));
    const set = (id: string, n: number, next?: Json): Json => ({
      type: "variables_set",
      fields: { VAR: { id } },
      inputs: { VALUE: { block: { type: "math_number", fields: { NUM: n } } } },
      ...(next ? { next: { block: next } } : {}),
    });
    const code = blocksToCode(ws([hat(LOOP_BLOCK, 0, set("robot", 1, set("console", 2, set("loop", 3, wheels(0.2, 0.3)))))], vars));
    const replies = runTicks(code, 3);
    expect(replies.at(-1)).toMatchObject({ type: "cmd", left: 0.2, right: 0.3 });
  });

  it("sensor, time and stop blocks use the robot API; print goes to the output, never alert()", () => {
    const read: Json = {
      type: "text_print",
      inputs: { TEXT: { block: { type: "robot_read", fields: { SENSOR: "distance" } } } },
      next: {
        block: {
          type: "text_print",
          inputs: { TEXT: { block: { type: "robot_time" } } },
          next: { block: wheels(0.7, 0.7, { type: "robot_stop" }) },
        },
      },
    };
    const code = blocksToCode(ws([hat(LOOP_BLOCK, 0, read)]));
    expect(code).toContain('robot.read("distance")');
    expect(code).toContain("robot.time");
    expect(code).not.toMatch(/alert|window/);
    const replies = runTicks(code, 2, { distance: 0.25 });
    expect(replies.at(-1)).toMatchObject({ type: "cmd", left: 0, right: 0, logs: ["0.25", "0.02"] });
  });

  it("every block in the toolbox makes code that the program runner accepts", () => {
    type Item = { kind: string; type?: string; contents?: Item[]; [k: string]: unknown };
    const items: Item[] = (TOOLBOX.contents as Item[]).flatMap((c) => c.contents ?? []);
    expect(items.length).toBeGreaterThan(20);
    for (const item of items) {
      const { kind: _kind, ...block } = item;
      const json = block as Json;
      // Statement blocks go inside a loop hat; value blocks are printed; hats stand alone.
      let top: Json;
      if (item.type === START_BLOCK || item.type === LOOP_BLOCK) top = { ...json, x: 0, y: 0 };
      else if (["math_number", "math_arithmetic", "math_single", "math_round", "math_modulo", "math_constrain", "math_random_float",
        "logic_compare", "logic_operation", "logic_negate", "logic_boolean", "robot_read", "robot_time", "text", "text_join"].includes(item.type!)) {
        top = hat(LOOP_BLOCK, 0, { type: "text_print", inputs: { TEXT: { block: json } } });
      } else if (item.type === "controls_flow_statements") {
        top = hat(LOOP_BLOCK, 0, { type: "controls_repeat_ext", inputs: { TIMES: { block: { type: "math_number", fields: { NUM: 2 } } }, DO: { block: json } } });
      } else top = hat(LOOP_BLOCK, 0, json);
      const code = blocksToCode(ws([top]));
      const last = runTicks(code, 2, { distance: 0.5, line_left: 0.01, line_right: 0.01 }).at(-1)!;
      expect(last.type, `${item.type}: ${JSON.stringify(last)}\n${code}`).toBe("cmd");
    }
  });
});

describe("block versions of the examples", () => {
  it("there is one for every example", () => {
    expect(Object.keys(BLOCK_EXAMPLES).sort()).toEqual(EXAMPLES.map((e) => e.id).sort());
  });

  /** Joint positions over time, sampled every 0.5 s. */
  function trajectory(code: string, seconds: number): number[][] {
    const sim = make(SENSORS_XML);
    const { controller } = runInline(sim, code, 0.02);
    const out: number[][] = [];
    const every = Math.round(0.5 / sim.timestep);
    for (let i = 1; i <= Math.round(seconds / sim.timestep); i++) {
      controller.beforeStep();
      sim.step();
      if (i % every === 0) out.push(Array.from(sim.snapshotQpos()));
    }
    expect(controller.state, JSON.stringify(controller.error)).toBe("running");
    expect(sim.instabilityCount()).toBe(0);
    return out;
  }

  for (const [id, seconds] of [["square", 11], ["avoid", 30], ["follow", 20]] as const) {
    it(`${id}: the blocks drive exactly like the code example for ${seconds} s`, () => {
      const fromBlocks = trajectory(blocksToCode(BLOCK_EXAMPLES[id]!), seconds);
      const fromCode = trajectory(findExample(id)!.code, seconds);
      expect(fromBlocks.length).toBe(fromCode.length);
      let worst = 0;
      fromBlocks.forEach((q, i) => q.forEach((v, j) => (worst = Math.max(worst, Math.abs(v - fromCode[i]![j]!)))));
      expect(worst).toBeLessThan(1e-6);
    });
  }
});

describe("Blockly stays out of the first page load", () => {
  /** Every .ts file under src/. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
    });
  }

  it("only the lazily loaded blocks editor imports Blockly or src/control/blocks.ts", () => {
    const allowed = new Set([join("src", "control", "blocks.ts"), join("src", "ui", "blocksEditor.ts")]);
    for (const file of sources("src")) {
      if (allowed.has(file)) continue;
      const text = readFileSync(file, "utf8");
      // `import type` is erased at build time, so it's fine.
      const staticImports = [
        ...(text.match(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"[^"]+"/gms) ?? []),
        ...(text.match(/^import\s+"[^"]+"/gm) ?? []), // side-effect imports
      ];
      for (const imp of staticImports) {
        expect(imp, `${file} loads Blockly eagerly`).not.toMatch(/"blockly|\/blocks"|\/blocksEditor"/);
      }
    }
  });
});
