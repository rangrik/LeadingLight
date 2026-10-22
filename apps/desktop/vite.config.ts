import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
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
