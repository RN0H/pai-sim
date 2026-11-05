/**
 * The page side of the controller sandbox: runs a program in a Web Worker
 * as a `Brain` for the lockstep Controller, with a watchdog. A tick that
 * doesn't answer in time (an endless loop, say) gets the worker terminated
 * and the program stopped with an error; pressing Run again starts a fresh
 * worker. Browser only.
 */
import { TICK_TIMEOUT_MS, type TickMessage } from "./api";
import { Controller, type ControllerEvents } from "./controller";
import type { Sim } from "../physics/engine";
// Vite bundles this as a classic worker in the build (module workers need
// Firefox 114+) and serves it as a module worker in `npm run dev`.
import ProgramWorker from "./worker?worker";

/** The first tick also loads the worker's script (slow on old phones) and runs the top-level code. */
export const FIRST_TICK_TIMEOUT_MS = 5 * TICK_TIMEOUT_MS;
/** Extra wait after the watchdog fires, in case the page itself was busy and the answer is queued. */
const GRACE_MS = 100;

export const SETUP_TIMEOUT_MESSAGE = `Your program's top-level code didn't finish within ${FIRST_TICK_TIMEOUT_MS / 1000} seconds, so it was stopped. Is there a loop that never ends? (Put repeating code in function loop(): it's called 50 times a second.)`;
export const TICK_TIMEOUT_MESSAGE = `Your loop() didn't finish within ${TICK_TIMEOUT_MS / 1000} second, so the program was stopped. Is there a loop inside it that never ends? (loop() is already called 50 times a second, so it doesn't need a while loop.)`;

class WorkerBrain {
  private worker: Worker | null;
  private timer = 0;
  /** seq of the tick waiting for an answer, or 0. */
  private pending = 0;
  controller: Controller | null = null;

  constructor() {
    this.worker = new ProgramWorker();
    this.worker.onmessage = (e: MessageEvent<unknown>) => {
      // Only the answer to the pending tick counts (the controller checks
      // the rest), so a program can't silence the watchdog by posting itself.
      const seq = (e.data as { seq?: unknown } | null)?.seq;
      if (this.pending === 0 || seq !== this.pending) return;
      this.pending = 0;
      clearTimeout(this.timer);
      this.controller?.receive(e.data);
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.pending = 0;
      clearTimeout(this.timer);
      this.controller?.timeout(`The program's worker crashed: ${e.message || "unknown error"}.`);
    };
  }

  send(msg: TickMessage): void {
    if (!this.worker) return;
    clearTimeout(this.timer);
    this.pending = msg.seq;
    const first = msg.code !== undefined;
    const fire = () => {
      if (this.pending !== msg.seq) return;
      // Give a reply that's already queued behind a busy page a moment to land.
      this.timer = window.setTimeout(() => {
        if (this.pending !== msg.seq) return;
        this.pending = 0;
        this.controller?.timeout(first ? SETUP_TIMEOUT_MESSAGE : TICK_TIMEOUT_MESSAGE);
      }, GRACE_MS);
    };
    this.timer = window.setTimeout(fire, first ? FIRST_TICK_TIMEOUT_MS : TICK_TIMEOUT_MS);
    this.worker.postMessage(msg);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.pending = 0;
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
