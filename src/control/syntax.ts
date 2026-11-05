/**
 * Find where a syntax error is. `new Function` throws a SyntaxError without
 * a line number in most browsers, so the worker re-parses failing code with
 * acorn to point beginners at the right line. Only the worker imports this.
 */
import { parse } from "acorn";

export function locateSyntaxError(code: string): { line: number; message: string } | null {
  try {
    // Same line numbering as the program wrapper: "use strict" on line 1, no newline.
    parse('"use strict";' + code, { ecmaVersion: "latest", sourceType: "script" });
    return null;
  } catch (err) {
    const loc = (err as { loc?: { line?: unknown } }).loc;
    if (!(err instanceof SyntaxError) || typeof loc?.line !== "number") return null;
    return { line: loc.line, message: err.message.replace(/\s*\(\d+:\d+\)$/, "") };
  }
}
