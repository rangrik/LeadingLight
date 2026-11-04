// Locate existing credentials only. This module never signs in, refreshes a
// token, resolves a remote secret, or reads a key file's contents.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";

export class Unavailable extends Error {}

export function claudeCredentialStore({ env = process.env, home = homedir(), username } = {}) {
  // Claude Code 2.1.314 hashes the raw NFC-normalized config variable, not
  // its realpath. A defined-empty secure-storage override selects the default.
  const dir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR;
  const defaultDir = join(home, ".claude");
  // Only the secure-storage override resets an empty value to the default;
  // an explicitly empty CLAUDE_CONFIG_DIR keeps the file relative to cwd.
  const storageDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined ? (dir || defaultDir) : (dir ?? defaultDir);
  const suffix = dir ? `-${createHash("sha256").update(dir.normalize("NFC")).digest("hex").slice(0, 8)}` : "";
  let account = env.USER || username;
  if (!account) { try { account = userInfo().username; } catch {} }
  if (!/^[a-zA-Z0-9._-]+$/.test(account || "")) account = "claude-code-user";
  return {
    file: join(storageDir.normalize("NFC"), ".credentials.json"),
    keychainArgs: ["find-generic-password", "-a", account, "-w", "-s", `Claude Code-credentials${suffix}`],
  };
}

export function gatewayLocations({ env = process.env, home = homedir(), os = platform() } = {}) {
  // Match statefile.Home/UserDir and cmd/berthd's additional "box" directory.
  const configHome = os === "darwin" ? join(home, "Library/Application Support")
    : os === "win32" ? (env.APPDATA || join(home, "AppData/Roaming"))
    : (env.XDG_CONFIG_HOME || join(home, ".config"));
  const state = env.BERTH_HOME || join(configHome, "berth");
  const user = env.BERTH_USER_DIR || join(home, ".berth");
  for (const name of ["BERTH_HOME", "BERTH_USER_DIR"]) {
    if (env[name] && !isAbsolute(env[name])) throw new Unavailable(`${name} must be an absolute path`);
  }
  const pair = (configDir, keyDir) => ({ config: join(configDir, "turncheck.json"), key: join(keyDir, "turncheck.key") });
  if (env.BERTH_HOME || env.BERTH_USER_DIR) {
    const locations = [pair(user, join(state, "box"))];
    // Preserve the older runner's explicitly selected, colocated fixture.
    if (env.BERTH_HOME && !env.BERTH_USER_DIR) locations.push(pair(state, state));
    return locations;
  }
  const locations = [];
  if (os === "darwin") {
    const runtime = join(configHome, "com.leadinglight.app/runtime");
    locations.push(pair(join(runtime, "user"), join(runtime, "box")));
  }
  locations.push(pair(user, join(state, "box")), pair(user, user));
  return locations;
}

export function gatewayFixture(options = {}) {
  const env = options.env || process.env;
  const explicitKey = env.BERTH_TURNCHECK_LIVE_KEY_FILE;
  const explicitModel = env.BERTH_TURNCHECK_LIVE_MODEL;
  // Explicit file selection wins over the standard Gateway environment aliases.
  // Never interpret VERCEL_TOKEN as a Gateway key: multi-team tokens also need
  // a team header that the pinned runtime does not send.
  const explicitValue = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  const credential = explicitKey ? { key: explicitKey } : explicitValue ? { keyValue: explicitValue } : null;
  if (explicitKey && !existsSync(explicitKey)) throw new Unavailable("BERTH_TURNCHECK_LIVE_KEY_FILE does not exist");
  if (credential && explicitModel) return { ...credential, model: explicitModel };
  for (const location of gatewayLocations(options)) {
    if (!existsSync(location.config)) continue;
    let cfg;
    try { cfg = JSON.parse(readFileSync(location.config, "utf8")); }
    catch { throw new Error(`cannot read provider configuration: ${location.config}`); }
    if (cfg?.provider !== "gateway") continue;
    // A reference supersedes a pasted key in the runtime. Never use a stale
    // key file in its place, or execute an op:// helper during discovery.
    const selected = credential || (!cfg.key && existsSync(location.key) ? { key: location.key } : null);
    const model = explicitModel || cfg.model;
    if (selected && typeof model === "string" && model.trim()) return { ...selected, model };
  }
  throw new Unavailable("Vercel AI Gateway requires a key (BERTH_TURNCHECK_LIVE_KEY_FILE, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN) and BERTH_TURNCHECK_LIVE_MODEL, or an existing gateway config and pasted key in the selected runtime");
}
