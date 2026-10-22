// node --experimental-strip-types --test src/lib/browser-sandbox.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { type BrowserHealth, canFixWithSudo, SANDBOX_FIX, sandboxCardState, sandboxCopy } from "./browser-sandbox.ts";

const blocked: BrowserHealth = { state: "sandbox", userns: "1", no_sandbox: false, setting: { no_sandbox: false }, fix: SANDBOX_FIX, text: "" };
const fixed: BrowserHealth = { state: "ok", userns: "0", no_sandbox: false, setting: { no_sandbox: false }, text: "" };
const noSandbox: BrowserHealth = { state: "ok", userns: "1", no_sandbox: true, no_sandbox_from: "setting", setting: { no_sandbox: true }, text: "" };

test("the card follows the box from blocked, through the terminal, to fixed", () => {
  assert.equal(sandboxCardState(blocked, "idle", false), "blocked");
  // The terminal is open with the command typed; the box hasn't changed yet.
  assert.equal(sandboxCardState(blocked, "fixing", true), "fixing");
  // sudo worked: the box says ok, and this card saw it blocked.
  assert.equal(sandboxCardState(fixed, "fixing", true), "fixed");
  // sudo was cancelled or refused: checking finds it still blocked.
  assert.equal(sandboxCardState(blocked, "checked", true), "still-blocked");
  assert.equal(sandboxCopy("still-blocked", "devl", blocked).title, "Still blocked");
});

test("a box that was never blocked shows nothing, and other failures aren't this card's", () => {
  assert.equal(sandboxCardState(undefined, "idle", false), "hidden");
  assert.equal(sandboxCardState(fixed, "idle", false), "hidden");
  assert.equal(sandboxCardState({ ...fixed, state: "error", error: "crashed" }, "idle", false), "hidden");
});

test("running without the sandbox shows in Settings while it is on, and in the agent's view only right after", () => {
  assert.equal(sandboxCardState(noSandbox, "idle", false, true), "no-sandbox");
  assert.equal(sandboxCardState(noSandbox, "idle", false), "hidden");
  assert.equal(sandboxCardState(noSandbox, "idle", true), "no-sandbox");
  assert.match(sandboxCopy("no-sandbox", "devl", noSandbox).body, /proxy still confines it to the worktree's own pages/);
  // The environment variable wins, and the card says so.
  assert.match(sandboxCopy("no-sandbox", "devl", { ...noSandbox, no_sandbox_from: "env" }).body, /BERTH_BROWSER_NO_SANDBOX=1/);
});

test("the sudo fix is offered only where Ubuntu's setting is the cause", () => {
  assert.equal(canFixWithSudo(blocked), true);
  assert.equal(canFixWithSudo({ ...blocked, userns: undefined, fix: undefined }), false);
  assert.match(sandboxCopy("blocked", "devl", blocked).body, /never sees the password/);
  assert.match(sandboxCopy("blocked", "devl", { ...blocked, userns: undefined }).body, /without its sandbox/);
  assert.equal(sandboxCopy("blocked", "devl", { ...blocked, likely: true }).title, "The agent's browser won't start on devl");
  // Typed as one line, so one Enter runs both halves.
  assert.ok(!SANDBOX_FIX.includes("\n"));
  assert.match(SANDBOX_FIX, /^sudo sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0 && echo .* \| sudo tee \/etc\/sysctl\.d\/60-chromium\.conf$/);
});
