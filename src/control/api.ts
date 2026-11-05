/**
 * The controller sandbox's shared vocabulary: the messages between the page
 * and the program's Web Worker, and the timing constants. Pure types and
 * numbers; no DOM, no MuJoCo.
 *
 * The user's program sees one object, `robot`:
 *   robot.setWheels(left, right)  wheel speeds from -1 (full reverse) to 1 (full forward)
 *   robot.read(sensorName)        a sensor's value (e.g. "distance", "line_left")
 *   robot.time                    seconds since the program started
 * Top-level code runs once when the program starts; if it defines
 * `function loop() {}`, that is called on every control tick (50 times a second).
 */

/** Control ticks per simulated second. */
export const CONTROL_HZ = 50;

/** How long one tick (or the program's start-up) may run before it's stopped, in ms. */
export const TICK_TIMEOUT_MS = 1000;

/** Most `console.log` lines kept per tick, and characters per line. */
export const MAX_LOG_LINES = 20;
export const MAX_LOG_CHARS = 200;

/** Page → worker: run one control tick. The first tick of a run carries the code. */
export interface TickMessage {
  type: "tick";
  seq: number;
  /** Seconds since the program started. */
  time: number;
  /** Every sensor on the robot by name (first value of each). */
  sensors: Record<string, number>;
  /** Present on the first tick: the program to load (its top-level code runs first). */
  code?: string;
}

/** Worker → page: the wheel command after a tick. */
export interface CommandReply {
  type: "cmd";
  seq: number;
  /** Wheel speeds as a fraction of top speed, each in [-1, 1]. */
  left: number;
  right: number;
  /** Lines the program printed with console.log during this tick. */
  logs: string[];
}

export interface ProgramError {
  /** Plain-language description, without the line number. */
  message: string;
  /** 1-based line in the user's code, when known. */
  line: number | null;
  /** "syntax": the code couldn't be read; "runtime": it threw; "timeout": it took too long. */
  kind: "syntax" | "runtime" | "timeout";
}

/** Worker → page: the program failed; it won't be ticked again. */
export interface ErrorReply extends ProgramError {
  type: "error";
  seq: number;
  logs: string[];
}

export type Reply = CommandReply | ErrorReply;

/** "Line 3: message", or just the message when the line is unknown. */
export function formatProgramError(err: ProgramError): string {
  return err.line !== null ? `Line ${err.line}: ${err.message}` : err.message;
}

const isLogs = (v: unknown): v is string[] => Array.isArray(v) && v.length <= MAX_LOG_LINES && v.every((x) => typeof x === "string");
const finite1 = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/**
 * Check a message from the worker. Anything that isn't a well-formed reply
 * gives null; wheel speeds are clamped to [-1, 1] and must be finite.
 */
export function parseReply(data: unknown): Reply | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.seq !== "number" || !isLogs(d.logs)) return null;
  const logs = d.logs.map((l) => l.slice(0, MAX_LOG_CHARS));
  if (d.type === "cmd") {
    if (typeof d.left !== "number" || typeof d.right !== "number" || !Number.isFinite(d.left) || !Number.isFinite(d.right)) return null;
    return { type: "cmd", seq: d.seq, left: finite1(d.left), right: finite1(d.right), logs };
  }
  if (d.type === "error") {
    const kind = d.kind === "syntax" || d.kind === "runtime" || d.kind === "timeout" ? d.kind : "runtime";
    const line = typeof d.line === "number" && Number.isInteger(d.line) && d.line > 0 ? d.line : null;
    const message = typeof d.message === "string" ? d.message.slice(0, 500) : "The program failed.";
    return { type: "error", seq: d.seq, kind, line, message, logs };
  }
  return null;
}
