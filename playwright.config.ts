import { defineConfig } from "@playwright/test";

const baseURL = process.env["BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env["BASE_URL"]
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
