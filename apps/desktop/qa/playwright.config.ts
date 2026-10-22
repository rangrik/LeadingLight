import { defineConfig } from "@playwright/test";

// Headless only. QA must never open a window on the user's screen.
export default defineConfig({
  testDir: ".",
  outputDir: ".results",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  // "gallery" only takes screenshots for design review (pnpm qa:gallery).
  projects: [
    { name: "qa", grepInvert: /@gallery/ },
    { name: "gallery", grep: /@gallery/ },
  ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1280, height: 800 },
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
