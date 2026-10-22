import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const host = process.env.TAURI_DEV_HOST;
const here = import.meta.dirname;
const shipyard = path.resolve(here, "../../vendor/shipyard");
const upstream = JSON.parse(fs.readFileSync(path.join(shipyard, "UPSTREAM.json"), "utf8")) as { commit: string; version: string };

// Shiki's wasm engine is never used: code is highlighted with its JavaScript
// engine. From vendor/shipyard/app/vite.config.ts.
function noShikiWasm(): Plugin {
  return {
    name: "no-shiki-wasm",
    enforce: "pre",
    resolveId: (id) => (id === "shiki/wasm" ? "\0no-shiki-wasm" : undefined),
    load: (id) => (id === "\0no-shiki-wasm" ? "export default undefined;" : undefined),
  };
}

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), noShikiWasm()],
  worker: { format: "es" as const, plugins: () => [noShikiWasm()] },
  // The vendored Shipyard code (vendor/shipyard/README.md) runs on its mock
  // fixtures, as Shipyard's live demo does, until there is an agent backend.
  define: { __BERTH_DEMO__: "true", __BERTH_COMMIT__: JSON.stringify(upstream.commit.slice(0, 7)), __BERTH_VERSION__: JSON.stringify(upstream.version) },
  resolve: {
    alias: [
      // Our shortcuts table and our themes, in Shipyard's places (vendor/shipyard/README.md).
      { find: "@/lib/shortcuts.json", replacement: path.resolve(here, "src/lib/shortcuts.json") },
      { find: "@/themes/builtin", replacement: path.resolve(here, "../../packages/themes/src/builtin.ts") },
      { find: /^@\//, replacement: `${path.join(shipyard, "app/src")}/` },
      { find: "@berth/plugin/ui", replacement: path.join(shipyard, "packages/plugin-sdk/src/ui.ts") },
      { find: "@berth/plugin", replacement: path.join(shipyard, "packages/plugin-sdk/src/index.ts") },
      { find: /^~\//, replacement: `${path.resolve(here, "src")}/` },
    ],
  },
  // Keep Rust errors visible and use the fixed port Tauri expects.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // IPv4 so the Berth proxy can reach it; Tauri loads it by the same address.
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/qa/**"] },
  },
}));
