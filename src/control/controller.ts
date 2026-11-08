/**
 * Runs a controller program against a Sim in lockstep: every 1/50 s of
 * simulated time the physics pauses, the program gets the sensor readings,
 * and physics resumes with its wheel command. So a run is deterministic
 * (the same program and robot always give the same trajectory), however
 * slow the device or the worker is.
 *
 * The program itself runs behind a `Brain`: a Web Worker in the page
 * (src/control/host.ts), or a ProgramRunner called directly in unit tests.
 * No DOM here.
 */
import { DEFAULT_DRIVE_SPEED, MAX_DRIVE_SPEED } from "../app/drive";
import type { Sim } from "../physics/engine";
import { CONTROL_HZ, parseReply, type ProgramError, type Reply, type TickMessage } from "./api";
import { ProgramRunner } from "./program";

/** Where ticks go. The brain answers each one by calling `controller.receive()`, possibly right away. */
export interface Brain {
  send(msg: TickMessage): void;
  /** Stop for good (terminate the worker). */
  dispose(): void;
}

export interface ControllerEvents {
  onLogs?(lines: string[]): void;
  onError?(err: ProgramError): void;
}

interface Wheel {
  id: number;
  /** ctrl value for a command of 1 (rad/s). */
  top: number;
}

/** A side's actuator and its top speed: the upper ctrl limit (capped), or the drive pad's default. */
function wheel(sim: Sim, name: string): Wheel | null {
  const id = sim.actuatorId(name);
  if (id < 0) return null;
  const limited = !!sim.model.actuator_ctrllimited[id];
  const max = sim.model.actuator_ctrlrange[2 * id + 1]!;
  const top = limited && Number.isFinite(max) && max > 0 ? Math.min(max, MAX_DRIVE_SPEED) : DEFAULT_DRIVE_SPEED;
  return { id, top };
}

/** Named sensors and where their first value sits in `sensordata`. */
function sensorSlots(sim: Sim): [string, number][] {
  return sim
    .sensorNames()
    .map((name, i): [string, number] => [name, sim.model.sensor_adr[i]!])
    .filter(([name]) => name !== "");
}

/** First value of every named sensor. */
export function readSensors(sim: Sim, slots = sensorSlots(sim)): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, adr] of slots) out[name] = sim.data.sensordata[adr]!;
  return out;
}

export type ControllerState = "running" | "stopped" | "failed";

export class Controller {
  private readonly leftWheel: Wheel | null;
  private readonly rightWheel: Wheel | null;
  private readonly stepsPerTick: number;
  private readonly slots: [string, number][];
  private stepsToTick = 0;
  private ticks = 0;
  private seq = 0;
  private waiting = false;
  private cmd = { left: 0, right: 0 };
  private _state: ControllerState = "running";
  private _error: ProgramError | null = null;

  /**
   * @param onResume called when a reply arrives after `beforeStep()` returned
   *   false, so the caller can continue stepping.
   */
  constructor(
    private readonly sim: Sim,
    private readonly code: string,
    private readonly brain: Brain,
    private readonly events: ControllerEvents = {},
    private readonly onResume: () => void = () => {},
  ) {
    this.leftWheel = wheel(sim, "left");
    this.rightWheel = wheel(sim, "right");
    // If the timestep doesn't divide 1/50 s, ticks come every whole number
    // of steps closest to it (robot.time still counts 1/50 s per tick).
    this.stepsPerTick = Math.max(1, Math.round(1 / CONTROL_HZ / sim.timestep));
    this.slots = sensorSlots(sim);
  }

  get state(): ControllerState {
    return this._state;
  }

  get error(): ProgramError | null {
    return this._error;
  }

  /** Last wheel command, each in [-1, 1]. */
  get wheels(): { left: number; right: number } {
    return { ...this.cmd };
  }

  /** Seconds of simulated time since the program started. */
  get time(): number {
    return this.ticks / CONTROL_HZ;
  }

  /**
   * Call before every physics step. Returns false while waiting for the
   * program: don't step until `onResume` fires (then call this again).
   */
  beforeStep(): boolean {
    if (this._state !== "running") return true; // the caller drives the wheels again
    if (this.waiting) return false;
    if (this.stepsToTick === 0) {
      this.waiting = true;
      const msg: TickMessage = { type: "tick", seq: ++this.seq, time: this.time, sensors: readSensors(this.sim, this.slots) };
      if (this.seq === 1) msg.code = this.code;
      this.brain.send(msg); // may reply synchronously
      if (this.waiting) return false;
    }
    this.applyWheels();
    this.stepsToTick--;
    return true;
  }

  /** A reply from the brain (checked: anything malformed fails the program). */
  receive(data: unknown): void {
    if (this._state !== "running" || !this.waiting) return;
    const reply = parseReply(data);
    if (reply === null) {
      this.waiting = false;
      this.fail({ kind: "runtime", line: null, message: "The program's worker sent a message that isn't a wheel command." });
      this.onResume();
      return;
    }
    if (reply.seq !== this.seq) return;
    this.waiting = false;
    if (reply.logs.length) this.events.onLogs?.(reply.logs);
    if (reply.type === "error") {
      const { message, line, kind } = reply;
      this.fail({ message, line, kind });
    } else {
      this.cmd = { left: reply.left, right: reply.right };
      this.ticks++;
      this.stepsToTick = this.stepsPerTick;
    }
    this.onResume();
  }

  /** The program took too long (the host's watchdog). */
  timeout(message: string): void {
    if (this._state !== "running") return;
    this.waiting = false;
    this.fail({ kind: "timeout", line: null, message });
    this.onResume();
  }

  /** Stop the program; the wheels stop. */
  stop(): void {
    if (this._state === "running") this._state = "stopped";
    this.waiting = false;
    this.cmd = { left: 0, right: 0 };
    this.applyWheels();
    this.brain.dispose();
  }

  private fail(err: ProgramError): void {
    this._state = "failed";
    this._error = err;
    this.cmd = { left: 0, right: 0 };
    this.applyWheels();
    this.brain.dispose();
    this.events.onError?.(err);
  }

  private applyWheels(): void {
    const ctrl = this.sim.data.ctrl;
    if (this.leftWheel) ctrl[this.leftWheel.id] = this.cmd.left * this.leftWheel.top;
    if (this.rightWheel) ctrl[this.rightWheel.id] = this.cmd.right * this.rightWheel.top;
  }
}

/** A brain that runs the program in this thread. For tests and tools only: a stuck program blocks. */
export class InlineBrain implements Brain {
  controller: Controller | null = null;

  /** @param runner runs the ticks: JavaScript by default, or a PythonRunner (src/control/python.ts). */
  constructor(private readonly runner: { handle(msg: TickMessage): Reply } = new ProgramRunner()) {}

  send(msg: TickMessage): void {
    this.controller?.receive(this.runner.handle(msg));
  }

  dispose(): void {}
}

/**
 * Run `code` on `sim` for `seconds` of simulated time, in this thread.
 * Returns the controller (state, error, wheels) and the logs. For tests.
 */
export function runInline(
  sim: Sim,
  code: string,
  seconds: number,
  runner?: { handle(msg: TickMessage): Reply },
): { controller: Controller; logs: string[] } {
  const brain = new InlineBrain(runner);
  const logs: string[] = [];
  const controller = new Controller(sim, code, brain, { onLogs: (l) => logs.push(...l) });
  brain.controller = controller;
  const steps = Math.round(seconds / sim.timestep);
  for (let i = 0; i < steps; i++) {
    if (!controller.beforeStep()) throw new Error("inline brain didn't answer");
    sim.step();
  }
  return { controller, logs };
}
