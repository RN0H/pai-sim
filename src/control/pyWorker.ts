/**
 * Web Worker that runs a Python controller program (see ./python.ts). Like
 * ./worker.ts, but it first loads Pyodide from our own site (the page tells
 * it where, in an "init" message), then says "ready" and answers ticks.
 * It's started as a module worker: Pyodide's loader doesn't support classic
 * workers (so Python needs a recent browser, e.g. Firefox 114+).
 *
 * Network and messaging APIs are removed only after Pyodide has loaded (it
 * needs fetch to load itself), and before any user code runs. Python's
 * `js` module sees the same, emptied, worker globals.
 */
import type { TickMessage } from "./api";
import { PythonRunner, type PythonRuntime } from "./python";
import { blockWorkerApis } from "./workerSafety";

/** Page → worker: load Pyodide from `indexURL` (ends with "/"). */
export interface InitMessage {
  type: "init";
  indexURL: string;
}

/** Worker → page: Pyodide loaded (or couldn't). */
export type LoadReply = { type: "ready" } | { type: "loadError"; message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<InitMessage | TickMessage>) => void) | null;
  postMessage(msg: unknown): void;
}
type LoadPyodide = (opts: { indexURL: string }) => Promise<PythonRuntime>;
const scope = self as unknown as WorkerScope & Record<string, unknown>;
const post = scope.postMessage.bind(scope);
let runner: PythonRunner | null = null;
let loading = false;

async function load(indexURL: string): Promise<void> {
  // A failed download of the WebAssembly file makes Pyodide log a warning and
  // then wait forever, so watch for that warning while loading.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warn.apply(console, args);
    if (/wasm instantiation failed|HTTP status code is not ok/i.test(args.map(String).join(" "))) {
      loadFailed(new Error("the Python runtime didn't download"));
    }
  };
  try {
    await loadRuntime(indexURL);
  } finally {
    console.warn = warn;
  }
}

async function loadRuntime(indexURL: string): Promise<void> {
  const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide?: LoadPyodide };
  if (typeof mod.loadPyodide !== "function") throw new Error("the Python loader didn't start");
  const py = await mod.loadPyodide({ indexURL });
  runner = new PythonRunner(py);
}

function loadFailed(err: unknown): void {
  if (!loading) return;
  loading = false;
  const message = err instanceof Error ? err.message : String(err);
  post({ type: "loadError", message: message.slice(0, 300) } satisfies LoadReply);
}

// Pyodide reports some download failures (e.g. of the WebAssembly file) only as an unhandled rejection.
self.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  if (!loading) return;
  e.preventDefault();
  loadFailed(e.reason);
});

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    if (loading || runner) return;
    loading = true;
    load(msg.indexURL).then(() => {
      if (!loading) return; // already failed
      loading = false;
      blockWorkerApis(scope);
      post({ type: "ready" } satisfies LoadReply);
    }, loadFailed);
    return;
  }
  if (msg.type === "tick" && runner) post(runner.handle(msg));
};
