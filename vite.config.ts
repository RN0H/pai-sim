import { defineConfig } from "vitest/config";

/** Oldest browsers we support: iOS/macOS Safari 15, and Chromium/Firefox of the same era. */
export const BUILD_TARGET = ["es2021", "safari15", "chrome90", "edge90", "firefox90"];

// Served from https://rn0h.github.io/pai-sim/, so assets live under /pai-sim/.
export default defineConfig({
  base: "/pai-sim/",
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
