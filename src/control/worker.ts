/**
 * Web Worker that runs the user's controller program (see ./program.ts).
 * The page sends one tick at a time and waits for the reply; a program that
 * never replies is terminated by the page (./host.ts), so a stuck or broken
 * program can't freeze it.
 *
 * Programs may come from share links (M6), so before any user code runs
 * the worker removes what it doesn't need: messaging the page directly and
 * the network (no tracking beacons from someone else's code).
 */
import type { TickMessage } from "./api";
import { ProgramRunner } from "./program";
import { locateSyntaxError } from "./syntax";

interface WorkerScope {
  onmessage: ((e: MessageEvent<TickMessage>) => void) | null;
  postMessage(msg: unknown): void;
}
// The worker global scope; typed loosely because tsconfig uses the DOM lib.
const scope = self as unknown as WorkerScope & Record<string, unknown>;
const post = scope.postMessage.bind(scope);
const runner = new ProgramRunner(locateSyntaxError);

scope.onmessage = (e) => {
  post(runner.handle(e.data));
};

const BLOCKED = [
  "postMessage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "WebTransport",
  "RTCPeerConnection",
];
// Shadow each one on the global and on its prototypes (so
// `Object.getPrototypeOf(self).postMessage` is gone too).
for (let obj: object | null = scope; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)) {
  for (const name of BLOCKED) {
    if (obj !== scope && !Object.prototype.hasOwnProperty.call(obj, name)) continue;
    try {
      Object.defineProperty(obj, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // Locked by the browser: leave it (the page checks every reply anyway).
    }
  }
}
// Keep the handler: a program assigning `onmessage` can't take over ticks.
try {
  const handler = scope.onmessage;
  Object.defineProperty(scope, "onmessage", { value: handler, writable: false, configurable: false });
} catch {
  // Older engines: the handler stays assignable; the page still checks every reply.
}
