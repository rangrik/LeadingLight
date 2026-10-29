import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const concept = ["one", "two", "three"].includes(mode) ? mode : "one";
  return {
    root: resolve(directory, concept),
    plugins: [react(), tailwindcss()],
    server: { host: "127.0.0.1", fs: { allow: [resolve(directory, "../..")] } },
    build: { outDir: resolve(directory, "dist", concept), emptyOutDir: true },
  };
});
