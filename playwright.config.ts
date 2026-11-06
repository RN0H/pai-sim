import { defineConfig } from "@playwright/test";

// Locally, set CHROME_PATH to use an installed Chrome instead of Playwright's download.
const executablePath = process.env.CHROME_PATH;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Real-time checks need the CPU to themselves: two software-rendered
  // browsers at once on a CI runner each fall below real time.
  workers: process.env.CI ? 1 : undefined,
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4173/pai-sim/",
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173/pai-sim/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
