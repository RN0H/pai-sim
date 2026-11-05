/**
 * Web Worker that runs the user's controller program (see ./program.ts).
 * The page sends one tick at a time and waits for the reply; a program that
 * never replies is terminated by the page (./host.ts), so a stuck or broken
 * program can't freeze it.
 */
import type { TickMessage } from "./api";
import { ProgramRunner } from "./program";
import { locateSyntaxError } from "./syntax";

const runner = new ProgramRunner(locateSyntaxError);

// The worker global scope; typed loosely because tsconfig uses the DOM lib.
const scope = self as unknown as { onmessage: ((e: MessageEvent<TickMessage>) => void) | null; postMessage(msg: unknown): void };
scope.onmessage = (e) => {
  scope.postMessage(runner.handle(e.data));
};
