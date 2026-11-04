import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { claudeCredentialStore, gatewayFixture, gatewayLocations, Unavailable } from "./provider-credentials.mjs";

function fixture(t, env = {}) {
  const home = mkdtempSync(join(tmpdir(), "ll-credential-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const options = { home, env, os: "darwin" };
  const write = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { mode: 0o600 });
  };
  const configured = (location, model, extra = {}) => {
    write(location.config, JSON.stringify({ provider: "gateway", model, ...extra }));
    write(location.key, "synthetic-test-credential\n");
  };
  return { options, write, configured, locations: gatewayLocations(options) };
}

test("finds embedded split credentials before native berth and legacy colocated state", (t) => {
  const f = fixture(t);
  assert.deepEqual(f.locations[0], {
    config: join(f.options.home, "Library/Application Support/com.leadinglight.app/runtime/user/turncheck.json"),
    key: join(f.options.home, "Library/Application Support/com.leadinglight.app/runtime/box/turncheck.key"),
  });
  f.configured(f.locations[2], "legacy-model");
  f.configured(f.locations[1], "native-model");
  f.configured(f.locations[0], "embedded-model");
  assert.deepEqual(gatewayFixture(f.options), { key: f.locations[0].key, model: "embedded-model" });
});

test("finds the actual macOS berth box key with ~/.berth configuration", (t) => {
  const f = fixture(t);
  f.configured(f.locations[1], "native-model");
  assert.deepEqual(gatewayFixture(f.options), {
    key: join(f.options.home, "Library/Application Support/berth/box/turncheck.key"),
    model: "native-model",
  });
});

test("retains legacy colocated credentials without crossing config/key pairs", (t) => {
  const f = fixture(t);
  f.write(f.locations[0].config, JSON.stringify({ provider: "gateway", model: "wrong-model" }));
  f.configured(f.locations[2], "legacy-model");
  assert.deepEqual(gatewayFixture(f.options), { key: f.locations[2].key, model: "legacy-model" });
});

test("explicit runtime directories limit discovery even when an app credential exists", (t) => {
  const f = fixture(t);
  f.configured(f.locations[0], "embedded-model");
  f.options.env = { BERTH_HOME: join(f.options.home, "chosen-state"), BERTH_USER_DIR: join(f.options.home, "chosen-user") };
  const [chosen] = gatewayLocations(f.options);
  assert.equal(chosen.config, join(f.options.env.BERTH_USER_DIR, "turncheck.json"));
  assert.equal(chosen.key, join(f.options.env.BERTH_HOME, "box/turncheck.key"));
  assert.throws(() => gatewayFixture(f.options), Unavailable);
  f.configured(chosen, "chosen-model");
  assert.deepEqual(gatewayFixture(f.options), { key: chosen.key, model: "chosen-model" });
});

test("BERTH_HOME alone keeps the runtime's default user directory and legacy fixture fallback", (t) => {
  const f = fixture(t);
  f.options.env.BERTH_HOME = join(f.options.home, "chosen-state");
  const locations = gatewayLocations(f.options);
  assert.equal(locations[0].config, join(f.options.home, ".berth/turncheck.json"));
  f.configured(locations[1], "old-fixture-model");
  assert.deepEqual(gatewayFixture(f.options), { key: locations[1].key, model: "old-fixture-model" });
});

test("explicit live key and model take precedence without consulting malformed defaults", (t) => {
  const f = fixture(t);
  f.write(f.locations[0].config, "invalid JSON");
  const key = join(f.options.home, "explicit.key");
  f.write(key, "synthetic-test-credential");
  f.options.env = { BERTH_TURNCHECK_LIVE_KEY_FILE: key, BERTH_TURNCHECK_LIVE_MODEL: "explicit-model" };
  assert.deepEqual(gatewayFixture(f.options), { key, model: "explicit-model" });
  f.options.env.BERTH_TURNCHECK_LIVE_KEY_FILE = join(f.options.home, "missing.key");
  assert.throws(() => gatewayFixture(f.options), /KEY_FILE does not exist/);
});

test("one live override keeps its precedence while the other value comes from a gateway config", (t) => {
  const f = fixture(t);
  f.configured(f.locations[1], "configured-model");
  f.options.env.BERTH_TURNCHECK_LIVE_MODEL = "override-model";
  assert.deepEqual(gatewayFixture(f.options), { key: f.locations[1].key, model: "override-model" });
  const key = join(f.options.home, "override.key");
  f.write(key, "synthetic-test-credential");
  f.options.env = { BERTH_TURNCHECK_LIVE_KEY_FILE: key };
  assert.deepEqual(gatewayFixture(f.options), { key, model: "configured-model" });
});

test("explicit Gateway environment keys precede saved keys but still require a model", (t) => {
  const f = fixture(t);
  f.options.env = { AI_GATEWAY_API_KEY: "synthetic-gateway-key", VERCEL_OIDC_TOKEN: "synthetic-oidc-token" };
  assert.throws(() => gatewayFixture(f.options), Unavailable);
  f.configured(f.locations[1], "configured-model");
  assert.deepEqual(gatewayFixture(f.options), { keyValue: "synthetic-gateway-key", model: "configured-model" });
  delete f.options.env.AI_GATEWAY_API_KEY;
  assert.deepEqual(gatewayFixture(f.options), { keyValue: "synthetic-oidc-token", model: "configured-model" });
  f.options.env.BERTH_TURNCHECK_LIVE_KEY_FILE = f.locations[1].key;
  assert.deepEqual(gatewayFixture(f.options), { key: f.locations[1].key, model: "configured-model" });
  f.options.env.BERTH_TURNCHECK_LIVE_KEY_FILE = join(f.options.home, "missing.key");
  assert.throws(() => gatewayFixture(f.options), /KEY_FILE does not exist/);
});

test("does not treat a general Vercel access token as a Gateway credential", (t) => {
  const f = fixture(t, { VERCEL_TOKEN: "synthetic-vercel-token", BERTH_TURNCHECK_LIVE_MODEL: "typesafe-ai/jev" });
  assert.throws(() => gatewayFixture(f.options), Unavailable);
});

test("never uses another provider's config or a stale pasted key superseded by a reference", (t) => {
  const f = fixture(t);
  f.configured(f.locations[0], "openai-model", { provider: "openai" });
  f.configured(f.locations[1], "gateway-model", { key: "env://SYNTHETIC_GATEWAY_KEY" });
  assert.throws(() => gatewayFixture(f.options), Unavailable);
  f.options.env.BERTH_TURNCHECK_LIVE_KEY_FILE = f.locations[1].key;
  assert.deepEqual(gatewayFixture(f.options), { key: f.locations[1].key, model: "gateway-model" });
});

test("Linux uses XDG_CONFIG_HOME and both runtime overrides require absolute paths", () => {
  const options = { home: "/example/home", os: "linux", env: { XDG_CONFIG_HOME: "/example/config" } };
  assert.deepEqual(gatewayLocations(options)[0], {
    config: "/example/home/.berth/turncheck.json", key: "/example/config/berth/box/turncheck.key",
  });
  for (const name of ["BERTH_HOME", "BERTH_USER_DIR"]) {
    assert.throws(() => gatewayLocations({ ...options, env: { [name]: "relative" } }), /must be an absolute path/);
  }
});

test("Claude default Keychain lookup selects the OS account explicitly", () => {
  assert.deepEqual(claudeCredentialStore({ env: {}, home: "/example/home", username: "local-user" }), {
    file: "/example/home/.claude/.credentials.json",
    keychainArgs: ["find-generic-password", "-a", "local-user", "-w", "-s", "Claude Code-credentials"],
  });
});

test("an explicitly empty Claude config directory keeps credential files relative to cwd", () => {
  const options = { env: { CLAUDE_CONFIG_DIR: "" }, home: "/example/home", username: "local-user" };
  const store = claudeCredentialStore(options);
  assert.equal(store.file, ".credentials.json");
  assert.equal(store.keychainArgs.at(-1), "Claude Code-credentials");
  options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = "";
  assert.equal(claudeCredentialStore(options).file, "/example/home/.claude/.credentials.json");
});

test("Claude custom directory hashes the raw NFC value, even for an explicit default path", () => {
  for (const [dir, suffix] of [["/example/home/.claude", "64193d4c"], ["./custom/", "42fafe08"], ["/example/cafe\u0301", "c3afbe10"]]) {
    const store = claudeCredentialStore({ env: { CLAUDE_CONFIG_DIR: dir, USER: "selected-user" } });
    assert.equal(store.keychainArgs.at(-1), `Claude Code-credentials-${suffix}`);
    assert.equal(store.keychainArgs[2], "selected-user");
  }
});

test("Claude secure-storage override controls both stores, including defined-empty reset", () => {
  const options = { home: "/example/home", username: "local-user", env: { CLAUDE_CONFIG_DIR: "/example/config", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/example/storage" } };
  const store = claudeCredentialStore(options);
  assert.equal(store.file, "/example/storage/.credentials.json");
  assert.notEqual(store.keychainArgs.at(-1), claudeCredentialStore({ ...options, env: { CLAUDE_CONFIG_DIR: "/example/config" } }).keychainArgs.at(-1));
  options.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = "";
  options.env.USER = "invalid username";
  assert.deepEqual(claudeCredentialStore(options), {
    file: "/example/home/.claude/.credentials.json",
    keychainArgs: ["find-generic-password", "-a", "claude-code-user", "-w", "-s", "Claude Code-credentials"],
  });
});
