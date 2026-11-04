// Import only the explicit live-test settings staged by test-providers.mjs.
// The ordinary isolated runtime suite never inherits the person's credentials.
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";

const allowed = new Set([
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "OPENCODE_CONFIG", "OPENCODE_DISABLE_PROJECT_CONFIG",
  "BERTH_LIVE_CODEX", "BERTH_LIVE_CODEX_MODEL", "BERTH_LIVE_CLAUDE", "BERTH_LIVE_ACP", "BERTH_LIVE_ACP_MODEL",
  "BERTH_TEST_REAL_AGENT_BROWSER", "AGENT_BROWSER_EXECUTABLE_PATH", "AGENT_BROWSER_ARGS", "AGENT_BROWSER_SOCKET_DIR",
  "BERTH_TURNCHECK_LIVE_KEY_FILE", "BERTH_TURNCHECK_LIVE_MODEL",
]);
const privatePaths = new Set([
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  "OPENCODE_CONFIG", "AGENT_BROWSER_SOCKET_DIR", "BERTH_TURNCHECK_LIVE_KEY_FILE",
]);

async function owned(path, directory = false, privateMode = false) {
  const st = await lstat(path);
  if (st.isSymbolicLink() || st.uid !== process.getuid() ||
      (directory ? !st.isDirectory() : !st.isFile()) || (privateMode && (st.mode & 0o077))) {
    throw new Error("unsafe live-test fixture permissions or file type");
  }
}

export async function liveFixtureEnv(path, env) {
  if (!path) return {};
  if (!isAbsolute(path) || !/^ll-live\.[a-zA-Z0-9]{6}$/.test(basename(path))) throw new Error("invalid live-test fixture directory");
  await owned(path, true, true);
  const dir = await realpath(path);
  if (dirname(dir) !== await realpath("/tmp")) throw new Error("unexpected live-test fixture parent");
  await owned(join(dir, ".leadinglight-live-fixture"));
  const file = join(dir, "env.json");
  await owned(file, false, true);
  let values;
  try { values = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new Error("could not read the live-test fixture environment"); }
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("invalid live-test fixture environment");
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key) || typeof value !== "string" || value.includes("\0")) throw new Error(`invalid live-test setting: ${key}`);
    if (privatePaths.has(key)) {
      if (!isAbsolute(value) || value !== resolve(value)) throw new Error(`live-test path must be absolute and normalized: ${key}`);
      const rel = isAbsolute(value) ? relative(dir, value) : "..";
      if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`live-test path must stay inside its fixture: ${key}`);
      // Config/cache paths may not exist yet; check every existing ancestor.
      let part = dir;
      for (const component of rel.split("/").filter(Boolean)) {
        part = join(part, component);
        try {
          const st = await lstat(part);
          if (st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error(`unsafe live-test path: ${key}`);
        } catch (err) { if (err.code !== "ENOENT") throw err; }
      }
    }
  }
  const bin = join(dir, "bin");
  await owned(bin, true);
  for (const entry of await readdir(bin)) await owned(join(bin, entry));
  return { ...values, PATH: `${bin}${delimiter}${env.PATH || ""}` };
}
