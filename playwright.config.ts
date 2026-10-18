import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 90000,
  expect: { timeout: 15000 },
  testDir: "./qa",
  testMatch: "ui.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".qa/browser-results",
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1160, height: 820 },
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
});
