import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8766",
    channel: "msedge",
    headless: true,
    viewport: { width: 1440, height: 1050 },
  },
  webServer: {
    command: `"${path.resolve("../admin_backend/.venv/Scripts/python.exe")}" -m uvicorn --app-dir ../admin_backend main:app --host 127.0.0.1 --port 8766`,
    url: "http://127.0.0.1:8766/api/health",
    reuseExistingServer: false,
    env: { XHS_ADMIN_DATA: path.resolve(".test-data") },
  },
});
