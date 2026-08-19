import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/** Použij prohlížeč předinstalovaný v prostředí, pokud v něm je (jinak výchozí Playwright). */
function chromiumPath(): string | undefined {
  const fromEnv = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const root = "/opt/ms-playwright";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium-"))) {
    const candidate = `${root}/${dir}/chrome-linux/chrome`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.pw.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:8080",
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: chromiumPath() },
  },
});
