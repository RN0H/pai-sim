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
