/**
 * The page side of the controller sandbox: runs a program in a Web Worker
 * as a `Brain` for the lockstep Controller, with a watchdog. A tick that
 * doesn't answer within TICK_TIMEOUT_MS (an endless loop, say) gets the
 * worker terminated and the program stopped with an error; the next run
 * starts a fresh worker. Browser only.
 */
import { TICK_TIMEOUT_MS, type Reply, type TickMessage } from "./api";
import { Controller, type ControllerEvents } from "./controller";
import type { Sim } from "../physics/engine";

export const TIMEOUT_MESSAGE = `Your program didn't finish within ${TICK_TIMEOUT_MS / 1000} second, so it was stopped. Is there a loop that never ends? (loop() is already called 50 times a second, so it doesn't need a while loop.)`;

const FIRST_TICK_TIMEOUT_MS = 5 * TICK_TIMEOUT_MS;

class WorkerBrain {
  private worker: Worker | null;
  private timer = 0;
  controller: Controller | null = null;

  constructor() {
    // A classic (not module) worker: module workers need Firefox 114+.
    this.worker = new Worker(new URL("./worker.ts", import.meta.url));
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      clearTimeout(this.timer);
      this.controller?.receive(e.data);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      clearTimeout(this.timer);
      this.controller?.timeout(`The program's worker crashed: ${e.message || "unknown error"}.`);
    };
  }

  send(msg: TickMessage): void {
    if (!this.worker) return;
    clearTimeout(this.timer);
    // The first tick also loads the worker's script, which is slow on old phones.
    const ms = msg.code !== undefined ? FIRST_TICK_TIMEOUT_MS : TICK_TIMEOUT_MS;
    this.timer = window.setTimeout(() => this.controller?.timeout(TIMEOUT_MESSAGE), ms);
    this.worker.postMessage(msg);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
  }
}

/** Start `code` on `sim` in a fresh worker. */
export function startInWorker(sim: Sim, code: string, events: ControllerEvents, onResume: () => void): Controller {
  const brain = new WorkerBrain();
  const controller = new Controller(sim, code, brain, events, onResume);
  brain.controller = controller;
  return controller;
}
