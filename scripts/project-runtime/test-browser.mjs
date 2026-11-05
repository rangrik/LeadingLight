#!/usr/bin/env node
// Resolve the Chromium headless shell installed for this project's Playwright.
// The CLI reports its actual revision-specific cache location, including
// PLAYWRIGHT_BROWSERS_PATH; do not infer a revision from another browser.
import { execFileSync } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function resolveTestBrowser(desktopDir = "apps/desktop") {
  try {
    const desktop = resolve(desktopDir);
    const require = createRequire(join(desktop, "package.json"));
    const cli = require.resolve("@playwright/test/cli");
    const info = execFileSync(process.execPath, [cli, "install", "--dry-run", "--only-shell", "chromium"], {
      cwd: desktop, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"],
    });
    const match = info.match(/\(playwright chromium-headless-shell v[^\r\n]+\)\r?\n\s*Install location:\s*([^\r\n]+)/);
    const dir = match?.[1].trim();
    if (!dir || !isAbsolute(dir)) throw new Error("Playwright did not report a headless shell install location");
    const name = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
    const found = [];
    async function scan(path, depth) {
      if (depth > 4) return;
      let entries;
      try { entries = await readdir(path, { withFileTypes: true }); }
      catch (err) { if (err.code === "ENOENT") return; throw err; }
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await scan(child, depth + 1);
        else if (entry.isFile() && entry.name === name) {
          try { await access(child, constants.X_OK); found.push(child); }
          catch (err) { if (err.code !== "EACCES") throw err; }
        }
      }
    }
    await scan(dir, 0);
    if (found.length !== 1) throw new Error(`expected one executable headless shell in ${dir}, found ${found.length}`);
    return found[0];
  } catch (err) {
    throw new Error(`${err.message}. Run pnpm install --frozen-lockfile and pnpm --filter @leadinglight/desktop exec playwright install --only-shell chromium, or set BERTH_CHROMIUM (AGENT_BROWSER_EXECUTABLE_PATH for provider tests) to an installed browser.`, { cause: err });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(await resolveTestBrowser(process.argv[2])); }
  catch (err) {
    console.error(`Runtime test browser: ${err.message}`);
    process.exitCode = 1;
  }
}
