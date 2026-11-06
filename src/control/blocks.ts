/**
 * Blocks for controller programs: the robot's own blocks, the toolbox, the
 * block versions of the example programs, and the code generator that turns
 * a block workspace into the same program shape people write by hand
 * (top-level code runs once; `function loop()` runs every tick; see
 * program.ts).
 *
 * Pure logic: it uses Blockly's headless workspace only, never the DOM, so
 * unit tests run it in Node. Blockly is big (~800 KB), so only lazily loaded
 * code may import this file (src/ui/blocksEditor.ts); the page doesn't load
 * it until someone opens the Blocks view.
 */
import * as Blockly from "blockly/core";
import "blockly/blocks";
import { javascriptGenerator, JavascriptGenerator, Order } from "blockly/javascript";
import * as En from "blockly/msg/en";

/** Hat blocks: only blocks inside one of these run (loose blocks are ignored). */
export const START_BLOCK = "robot_start";
export const LOOP_BLOCK = "robot_loop";

/** Colours (Blockly hue) of the robot's own blocks. */
const ROBOT_HUE = 20;
const EVENT_HUE = 45;

/** Sensor names a compiled robot can have (src/robot/compile.ts). */
const SENSOR_OPTIONS: [string, string][] = [
  ["distance ahead", "distance"],
  ["left line probe", "line_left"],
  ["right line probe", "line_right"],
];

let registered = false;

/** Define the robot blocks and set Blockly's messages. Safe to call more than once. */
export function registerRobotBlocks(): void {
  if (registered) return;
  registered = true;
  // `import * as` gives a module namespace; setLocale wants a plain record.
  Blockly.setLocale({ ...(En as unknown as Record<string, string>) });
  Blockly.common.defineBlocksWithJsonArray([
    {
      type: START_BLOCK,
      message0: "when the program starts %1 %2",
      args0: [{ type: "input_dummy" }, { type: "input_statement", name: "DO" }],
      colour: EVENT_HUE,
      tooltip: "The blocks inside run once, when you press Run.",
      helpUrl: "",
    },
    {
      type: LOOP_BLOCK,
      message0: "every tick (50 times a second) %1 %2",
      args0: [{ type: "input_dummy" }, { type: "input_statement", name: "DO" }],
      colour: EVENT_HUE,
      tooltip: "The blocks inside run 50 times a second while the program runs.",
      helpUrl: "",
    },
    {
      type: "robot_set_wheels",
      message0: "set wheels left %1 right %2",
      args0: [
        { type: "input_value", name: "LEFT", check: "Number" },
        { type: "input_value", name: "RIGHT", check: "Number" },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      colour: ROBOT_HUE,
      tooltip: "Wheel speeds from -1 (full reverse) to 1 (full speed ahead). They stay set until you change them.",
      helpUrl: "",
    },
    {
      type: "robot_stop",
      message0: "stop wheels",
      previousStatement: null,
      nextStatement: null,
      colour: ROBOT_HUE,
      tooltip: "Set both wheel speeds to 0.",
      helpUrl: "",
    },
    {
      type: "robot_read",
      message0: "sensor %1",
      args0: [{ type: "field_dropdown", name: "SENSOR", options: SENSOR_OPTIONS }],
      output: "Number",
      colour: ROBOT_HUE,
      tooltip:
        "A sensor reading in metres. Distance ahead is -1 when nothing is in range. " +
        "A line probe reads a little less when it's over a line.",
      helpUrl: "",
    },
    {
      type: "robot_time",
      message0: "time (seconds)",
      output: "Number",
      colour: ROBOT_HUE,
      tooltip: "Seconds since the program started.",
      helpUrl: "",
    },
  ]);
}

let generator: JavascriptGenerator | null = null;

function getGenerator(): JavascriptGenerator {
  if (generator) return generator;
  registerRobotBlocks();
  // Our own generator instance, so we don't change Blockly's shared one.
  const gen = new JavascriptGenerator("JavaScript");
  Object.assign(gen.forBlock, javascriptGenerator.forBlock);
  // Variables made from blocks must not shadow the program's own names.
  gen.addReservedWords("robot,console,loop");
  // Hats are handled by blocksToCode(); their contents are generated there.
  gen.forBlock[START_BLOCK] = () => "";
  gen.forBlock[LOOP_BLOCK] = () => "";
  gen.forBlock["robot_set_wheels"] = (block, g) => {
    const left = g.valueToCode(block, "LEFT", Order.NONE) || "0";
    const right = g.valueToCode(block, "RIGHT", Order.NONE) || "0";
    return `robot.setWheels(${left}, ${right});\n`;
  };
  gen.forBlock["robot_stop"] = () => "robot.setWheels(0, 0);\n";
  gen.forBlock["robot_read"] = (block) => [`robot.read(${JSON.stringify(block.getFieldValue("SENSOR"))})`, Order.FUNCTION_CALL];
  gen.forBlock["robot_time"] = () => ["robot.time", Order.MEMBER];
  // Blockly's "print" shows an alert(); ours goes to the panel's output.
  gen.forBlock["text_print"] = (block, g) => {
    const msg = g.valueToCode(block, "TEXT", Order.NONE) || "''";
    return `console.log(${msg});\n`;
  };
  generator = gen;
  return gen;
}

/** Workspace JSON as saved by `Blockly.serialization.workspaces.save`. */
export type BlocksJson = Record<string, unknown>;

export const BLOCKS_HEADER = "// Made from your blocks. You can edit it here,\n// but the blocks won't change to match.\n";

/**
 * Generate the program for a workspace. Blocks inside "when the program
 * starts" become top-level code; blocks inside "every tick" become
 * `function loop()`. Several hats of the same kind run in order, top to
 * bottom. Blocks outside a hat don't run.
 */
export function workspaceToProgram(ws: Blockly.Workspace): string {
  const gen = getGenerator();
  gen.init(ws);
  let start = "";
  let loop = "";
  let hasLoop = false;
  for (const hat of ws.getTopBlocks(true)) {
    if (!hat.isEnabled()) continue;
    if (hat.type !== START_BLOCK && hat.type !== LOOP_BLOCK) continue;
    const first = hat.getInputTargetBlock("DO");
    const body = first ? gen.blockToCode(first) : "";
    if (typeof body !== "string") continue; // only value blocks return tuples
    if (hat.type === START_BLOCK) start += body;
    else {
      hasLoop = true;
      loop += body;
    }
  }
  let code = start;
  if (hasLoop) {
    if (code) code += "\n";
    code += `function loop() {\n${gen.prefixLines(loop, gen.INDENT)}}\n`;
  }
  // finish() adds the variable declarations (`var x;`) on top and resets the generator.
  code = gen.finish(code).replace(/\n{3,}/g, "\n\n");
  return BLOCKS_HEADER + (code.trim() ? code.replace(/^\n+/, "") : "");
}

/** Generate the program for saved workspace JSON, in a headless workspace. */
export function blocksToCode(json: BlocksJson): string {
  registerRobotBlocks();
  const ws = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(json, ws);
    return workspaceToProgram(ws);
  } finally {
    ws.dispose();
  }
}

// ---- Toolbox ------------------------------------------------------------------

const shadowNum = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });

/** The block palette. Categories keep it short enough for a phone. */
export const TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Robot",
      colour: String(ROBOT_HUE),
      contents: [
        { kind: "block", type: START_BLOCK },
        { kind: "block", type: LOOP_BLOCK },
        { kind: "block", type: "robot_set_wheels", inputs: { LEFT: shadowNum(0.5), RIGHT: shadowNum(0.5) } },
        { kind: "block", type: "robot_stop" },
        { kind: "block", type: "robot_read" },
        { kind: "block", type: "robot_time" },
      ],
    },
    {
      kind: "category",
      name: "Logic",
      categorystyle: "logic_category",
      contents: [
        { kind: "block", type: "controls_if" },
        { kind: "block", type: "controls_if", extraState: { hasElse: true } },
        { kind: "block", type: "logic_compare" },
        { kind: "block", type: "logic_operation" },
        { kind: "block", type: "logic_negate" },
        { kind: "block", type: "logic_boolean" },
      ],
    },
    {
      kind: "category",
      name: "Loops",
      categorystyle: "loop_category",
      contents: [
        { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: shadowNum(10) } },
        { kind: "block", type: "controls_whileUntil" },
        {
          kind: "block",
          type: "controls_for",
          inputs: { FROM: shadowNum(1), TO: shadowNum(10), BY: shadowNum(1) },
        },
        { kind: "block", type: "controls_flow_statements" },
      ],
    },
    {
      kind: "category",
      name: "Math",
      categorystyle: "math_category",
      contents: [
        { kind: "block", type: "math_number", fields: { NUM: 0 } },
        { kind: "block", type: "math_arithmetic", inputs: { A: shadowNum(1), B: shadowNum(1) } },
        { kind: "block", type: "math_single" },
        { kind: "block", type: "math_round" },
        { kind: "block", type: "math_modulo", inputs: { DIVIDEND: shadowNum(10), DIVISOR: shadowNum(3) } },
        { kind: "block", type: "math_constrain", inputs: { LOW: shadowNum(-1), HIGH: shadowNum(1) } },
        { kind: "block", type: "math_random_float" },
      ],
    },
    { kind: "category", name: "Variables", categorystyle: "variable_category", custom: "VARIABLE" },
    {
      kind: "category",
      name: "Text",
      categorystyle: "text_category",
      contents: [
        { kind: "block", type: "text_print", inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "hello" } } } } },
        { kind: "block", type: "text" },
        { kind: "block", type: "text_join" },
      ],
    },
  ],
};

// ---- Block programs ------------------------------------------------------------
// Small builders for workspace JSON, so the example programs below read
// roughly like the code they generate.

type Block = Record<string, unknown>;
type Input = { block: Block };

const num = (n: number): Input => ({ block: { type: "math_number", fields: { NUM: n } } });
const get = (id: string): Input => ({ block: { type: "variables_get", fields: { VAR: { id } } } });
const time = (): Input => ({ block: { type: "robot_time" } });
const sensor = (name: string): Input => ({ block: { type: "robot_read", fields: { SENSOR: name } } });
const arith = (op: "ADD" | "MINUS" | "MULTIPLY" | "DIVIDE", a: Input, b: Input): Input => ({
  block: { type: "math_arithmetic", fields: { OP: op }, inputs: { A: a, B: b } },
});
const compare = (op: "EQ" | "NEQ" | "LT" | "LTE" | "GT" | "GTE", a: Input, b: Input): Input => ({
  block: { type: "logic_compare", fields: { OP: op }, inputs: { A: a, B: b } },
});
/** `a and b`, with its two parts stacked so the block fits a narrow panel. */
const and = (a: Input, b: Input): Input => ({
  block: { type: "logic_operation", inline: false, fields: { OP: "AND" }, inputs: { A: a, B: b } },
});
const floor = (a: Input): Input => ({ block: { type: "math_round", fields: { OP: "ROUNDDOWN" }, inputs: { NUM: a } } });

const set = (id: string, value: Input): Block => ({ type: "variables_set", fields: { VAR: { id } }, inputs: { VALUE: value } });
const neg = (a: Input): Input => ({ block: { type: "math_single", fields: { OP: "NEG" }, inputs: { NUM: a } } });
const value = (v: number | Input): Input => (typeof v === "number" ? num(v) : v);
const wheels = (left: number | Input, right: number | Input): Block => ({
  type: "robot_set_wheels",
  inputs: { LEFT: value(left), RIGHT: value(right) },
});
const stop = (): Block => ({ type: "robot_stop" });

/** Chain statement blocks with `next`. */
function seq(...blocks: Block[]): Input {
  const [first, ...rest] = blocks;
  if (!first) throw new Error("seq() needs a block");
  const copy: Block = { ...first };
  if (rest.length) copy.next = seq(...rest);
  return { block: copy };
}

/** if / else if … / else. `branches` are [condition, statements]; `otherwise` is the else part. */
function ifElse(branches: [Input, Input][], otherwise?: Input): Block {
  const inputs: Record<string, Input> = {};
  branches.forEach(([cond, body], i) => {
    inputs[`IF${i}`] = cond;
    inputs[`DO${i}`] = body;
  });
  if (otherwise) inputs.ELSE = otherwise;
  return {
    type: "controls_if",
    extraState: { ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}), ...(otherwise ? { hasElse: true } : {}) },
    inputs,
  };
}

function hat(type: typeof START_BLOCK | typeof LOOP_BLOCK, x: number, y: number, body?: Input): Block {
  return { type, x, y, ...(body ? { inputs: { DO: body } } : {}) };
}

function program(variables: string[], hats: Block[]): BlocksJson {
  return {
    blocks: { languageVersion: 0, blocks: hats },
    variables: variables.map((name) => ({ name, id: name })),
  };
}

/** What the Blocks view starts with: the same as the starter code. */
export const STARTER_BLOCKS: BlocksJson = program([], [hat(LOOP_BLOCK, 20, 20, seq(wheels(0.5, 0.5)))]);

/**
 * Block versions of the example programs (src/control/examples.ts), with the
 * same ids and the same behaviour (tests/unit/blocks.test.ts checks it).
 */
export const BLOCK_EXAMPLES: Readonly<Record<string, BlocksJson>> = {
  // Same constants and the same arithmetic as the code, so it drives identically.
  square: program(
    ["SIDE", "TURN", "PAUSE", "SPEED", "leg", "corner", "t"],
    [
      hat(START_BLOCK, 20, 20, seq(set("SIDE", num(1.5)), set("TURN", num(0.46)), set("PAUSE", num(0.3)), set("SPEED", num(0.5)))),
      hat(
        LOOP_BLOCK,
        20,
        150,
        seq(
          set("leg", arith("ADD", arith("ADD", arith("ADD", get("SIDE"), get("PAUSE")), get("TURN")), get("PAUSE"))),
          set("corner", floor(arith("DIVIDE", time(), get("leg")))),
          set("t", arith("MINUS", time(), arith("MULTIPLY", get("corner"), get("leg")))),
          ifElse(
            [
              [compare("GTE", get("corner"), num(4)), seq(stop())],
              [compare("LT", get("t"), get("SIDE")), seq(wheels(get("SPEED"), get("SPEED")))],
              [
                and(
                  compare("GTE", get("t"), arith("ADD", get("SIDE"), get("PAUSE"))),
                  compare("LT", get("t"), arith("ADD", arith("ADD", get("SIDE"), get("PAUSE")), get("TURN"))),
                ),
                seq(wheels(neg(get("SPEED")), get("SPEED"))),
              ],
            ],
            seq(stop()),
          ),
        ),
      ),
    ],
  ),
  avoid: program(
    ["turnUntil", "d"],
    [
      hat(START_BLOCK, 20, 20, seq(set("turnUntil", num(-1)))),
      hat(
        LOOP_BLOCK,
        20,
        110,
        seq(
          set("d", sensor("distance")),
          ifElse([
            [
              and(compare("GTE", get("d"), num(0)), compare("LT", get("d"), num(0.4))),
              seq(set("turnUntil", arith("ADD", time(), num(0.2)))),
            ],
          ]),
          ifElse([[compare("LT", time(), get("turnUntil")), seq(wheels(-0.4, 0.4))]], seq(wheels(0.6, 0.6))),
        ),
      ),
    ],
  ),
  follow: program(
    ["left", "right"],
    [
      hat(
        LOOP_BLOCK,
        20,
        20,
        seq(
          set("left", sensor("line_left")),
          set("right", sensor("line_right")),
          ifElse(
            [
              [compare("LT", get("left"), arith("MINUS", get("right"), num(0.002))), seq(wheels(0.05, 0.4))],
              [compare("LT", get("right"), arith("MINUS", get("left"), num(0.002))), seq(wheels(0.4, 0.05))],
            ],
            seq(wheels(0.4, 0.4)),
          ),
        ),
      ),
    ],
  ),
};
