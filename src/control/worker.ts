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
import { blockWorkerApis } from "./workerSafety";

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

blockWorkerApis(scope);
