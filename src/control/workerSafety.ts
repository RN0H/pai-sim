/**
 * Removes what a controller program doesn't need from a worker's global
 * scope, before any user code runs: messaging the page directly, starting
 * more workers, storage, and the network (no tracking beacons from someone
 * else's code, since programs can come from share links). Shared by the
 * JavaScript worker (./worker.ts) and the Python worker (./pyWorker.ts).
 */

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

/** Shadow each blocked API on `scope` and its prototypes, and lock `onmessage` to its current handler. */
export function blockWorkerApis(scope: object): void {
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
    const handler = (scope as { onmessage?: unknown }).onmessage;
    Object.defineProperty(scope, "onmessage", { value: handler, writable: false, configurable: false });
  } catch {
    // Older engines: the handler stays assignable; the page still checks every reply.
  }
}
