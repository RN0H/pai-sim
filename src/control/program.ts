/**
 * Runs a user's controller program, one control tick at a time. This is the
 * code inside the Web Worker (src/control/worker.ts), and unit tests run it
 * directly in Node. Pure logic: no DOM, no MuJoCo.
 *
 * Program shape (Arduino-like): top-level code runs once, on the first tick;
 * a top-level `function loop() {}` is then called on every tick. Wheel
 * commands stick until the program changes them.
 *
 * This is NOT a security sandbox: the worker is. It keeps a stuck or broken
 * program away from the page; the page times it out and restarts it.
 */
import { MAX_LOG_CHARS, MAX_LOG_LINES, type ProgramError, type Reply, type TickMessage } from "./api";

/** The object a program drives. */
export interface RobotApi {
  setWheels(left: number, right: number): void;
  read(sensorName: string): number;
  readonly time: number;
}

/** A thrown error the program caused through the API, with a beginner-friendly message. */
class RobotUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobotUsageError";
  }
}

/** Wraps user code. Where user line 1 ends up in stack traces is measured by `firstUserLine()`. */
const HEADER = '"use strict";\n';
const FOOTER = '\n;return typeof loop === "function" ? loop : null;';
const PARAMS = ["robot", "console"] as const;

/** Find "<line>:<col>" of the first stack frame inside code made by `new Function`. */
const FRAME_RE = /(?:<anonymous>|> Function|> eval|Function code):(\d+):(\d+)/;

function frameLine(err: unknown): number | null {
  const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : "";
  const m = FRAME_RE.exec(stack);
  if (m) return Number(m[1]);
  // API misuse is thrown from our code, so its own line isn't the user's.
  if (err instanceof RobotUsageError) return null;
  // Safari puts the line on the error itself for the throwing frame.
  const line = (err as { line?: unknown } | null)?.line;
  return typeof line === "number" ? line : null;
}

let probeLine: number | null | undefined;
/**
 * Which stack line user line 1 is reported as. Engines number lines of
 * `new Function` code differently (some count a hidden header), so we
 * measure it once with a probe instead of hard-coding it.
 */
function firstUserLine(): number | null {
  if (probeLine === undefined) {
    try {
      new Function(...PARAMS, HEADER + "throw new Error('probe');" + FOOTER)(null, null);
      probeLine = null;
    } catch (err) {
      probeLine = frameLine(err);
    }
  }
  return probeLine;
}

/** The user's 1-based line for an error thrown from their code, if we can tell. */
export function userLine(err: unknown, codeLines: number): number | null {
  const at = frameLine(err);
  const first = firstUserLine();
  if (at === null || first === null) return null;
  const line = at - first + 1;
  return line >= 1 && line <= codeLines ? line : null;
}

function describe(err: unknown): string {
  if (err instanceof RobotUsageError) return err.message;
  if (err instanceof Error) {
    // "ReferenceError: foo is not defined" reads better than the bare message.
    return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
  }
  try {
    return `Your program threw ${JSON.stringify(err)}.`;
  } catch {
    return "Your program threw something that isn't an error.";
  }
}

function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

export class ProgramRunner {
  private loopFn: (() => void) | null = null;
  private started = false;
  private failed = false;
  private codeLines = 0;
  private left = 0;
  private right = 0;
  private time = 0;
  private sensors: Record<string, number> = {};
  private logs: string[] = [];
  private readonly robot: RobotApi;
  private readonly console: { log(...args: unknown[]): void };

  /**
   * @param locateSyntaxError optional: finds the line of a syntax error (the
   *   worker passes a parser here; `new Function` doesn't report one).
   */
  constructor(private readonly locateSyntaxError?: (code: string) => { line: number; message: string } | null) {
    const self = this;
    this.robot = Object.freeze({
      setWheels(left: unknown, right: unknown): void {
        if (typeof left !== "number" || typeof right !== "number" || !Number.isFinite(left) || !Number.isFinite(right)) {
          throw new RobotUsageError(
            `robot.setWheels(left, right) needs two numbers from -1 to 1, like robot.setWheels(0.5, 0.5). It got (${show(left)}, ${show(right)}).`,
          );
        }
        self.left = clamp1(left);
        self.right = clamp1(right);
      },
      read(name: unknown): number {
        if (typeof name === "string" && Object.prototype.hasOwnProperty.call(self.sensors, name)) return self.sensors[name]!;
        const have = Object.keys(self.sensors);
        const list = have.length ? `This robot has: ${have.map((n) => `"${n}"`).join(", ")}.` : "This robot has no sensors (add some in the builder).";
        throw new RobotUsageError(`There's no sensor called ${typeof name === "string" ? JSON.stringify(name) : show(name)}. ${list}`);
      },
      get time(): number {
        return self.time;
      },
    });
    const log = (...args: unknown[]) => {
      if (self.logs.length >= MAX_LOG_LINES) return;
      const line = args.map(show).join(" ");
      self.logs.push(line.length > MAX_LOG_CHARS ? line.slice(0, MAX_LOG_CHARS - 1) + "…" : line);
    };
    this.console = Object.freeze({ log, info: log, warn: log, error: log });
  }

  /** Run one tick. After an error reply the runner stays failed. */
  handle(msg: TickMessage): Reply {
    this.logs = [];
    this.time = msg.time;
    this.sensors = msg.sensors;
    if (this.failed) return this.error(msg.seq, { kind: "runtime", line: null, message: "The program has stopped." });

    if (!this.started) {
      this.started = true;
      const code = msg.code ?? "";
      this.codeLines = code.split("\n").length;
      let factory: (...args: unknown[]) => unknown;
      try {
        factory = new Function(...PARAMS, HEADER + code + FOOTER) as typeof factory;
      } catch (err) {
        const found = this.locateSyntaxError?.(code) ?? null;
        const message = found?.message ?? (err instanceof Error ? err.message : String(err));
        return this.error(msg.seq, { kind: "syntax", line: found?.line ?? null, message: `This code can't be read: ${message}` });
      }
      try {
        const loop = factory(this.robot, this.console);
        this.loopFn = typeof loop === "function" ? (loop as () => void) : null;
      } catch (err) {
        return this.error(msg.seq, this.runtimeError(err));
      }
    } else if (this.loopFn) {
      try {
        this.loopFn();
      } catch (err) {
        return this.error(msg.seq, this.runtimeError(err));
      }
    }
    return { type: "cmd", seq: msg.seq, left: this.left, right: this.right, logs: this.logs };
  }

  private runtimeError(err: unknown): ProgramError {
    if (err instanceof RangeError && /call stack/i.test(err.message)) {
      return { kind: "runtime", line: null, message: "A function keeps calling itself without stopping (too much recursion)." };
    }
    return { kind: "runtime", line: userLine(err, this.codeLines), message: describe(err) };
  }

  private error(seq: number, err: ProgramError): Reply {
    this.failed = true;
    return { type: "error", seq, ...err, logs: this.logs };
  }
}
