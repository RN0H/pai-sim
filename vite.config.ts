import { defineConfig } from "vitest/config";

// Served from https://rn0h.github.io/pai-sim/, so assets live under /pai-sim/.
export default defineConfig({
  base: "/pai-sim/",
  build: { target: "es2022", chunkSizeWarningLimit: 1200 },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
