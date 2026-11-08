import { defineConfig } from "vitest/config";
import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/** Oldest browsers we support: iOS/macOS Safari 15, and Chromium/Firefox of the same era. */
export const BUILD_TARGET = ["es2021", "safari15", "chrome90", "edge90", "firefox90"];

/**
 * Serves Pyodide (Python for the browser, ~12 MB) from our own site under
 * `<base>pyodide/`, straight from the pinned npm package: copied into the
 * build, and served from node_modules by the dev server. Nothing is fetched
 * from a CDN, and nothing is downloaded until someone runs a Python program
 * (src/control/pyWorker.ts loads it).
 */

/** What loadPyodide() fetches: the loader, the runtime, the standard library and the package index. */
export const PYODIDE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

const TYPES: Record<string, string> = {
  js: "text/javascript",
  mjs: "text/javascript",
  wasm: "application/wasm",
  zip: "application/zip",
  json: "application/json",
};

function pyodideDir(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("pyodide/package.json"));
}

export function pyodidePlugin(): Plugin {
  let base = "/";
  return {
    name: "pai-sim-pyodide",
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      const dir = pyodideDir();
      const prefix = `${base}pyodide/`;
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0]!;
        const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
        if (!PYODIDE_FILES.includes(name)) return next();
        res.setHeader("Content-Type", TYPES[name.split(".").pop()!] ?? "application/octet-stream");
        createReadStream(join(dir, name)).pipe(res);
      });
    },
    generateBundle() {
      const dir = pyodideDir();
      for (const name of PYODIDE_FILES) {
        this.emitFile({ type: "asset", fileName: `pyodide/${name}`, source: readFileSync(join(dir, name)) });
      }
    },
  };
}

// Served from https://rn0h.github.io/pai-sim/, so assets live under /pai-sim/.
export default defineConfig({
  base: "/pai-sim/",
  // Python programs: Pyodide is served from our own site, loaded on first use.
  plugins: [pyodidePlugin()],
  // Older iPhones can't update Safari past iOS 15/16, and Safari < 16.4 rejects
  // newer syntax (e.g. class static blocks in Three.js) with a blank page, so
  // lower the bundle to what Safari 15 parses. See tests/unit/compat.test.ts.
  build: { target: BUILD_TARGET, chunkSizeWarningLimit: 1200 },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
