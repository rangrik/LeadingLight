import type { ExecResult } from "@/lib/api";
import { mockDiff } from "@/lib/mock-diff";
import { mockIssues } from "@/lib/mock-issues";
import { mockHomeExec } from "@/lib/mock-home";

// mockShell answers the git and gh commands the built-in plugins run through
// exec, so they can be explored with ?mock=1. Anything else returns
// undefined and falls through to mock.ts's own exec fixture (a test check).

const notes = new Map<string, string>([["devl:shop/checkout-fix", "# checkout\n\n- retries: cap at 3, exponential backoff\n- ask Codex to review the webhook handler before merging\n"]]);

const STATUS = [
  "## me/fix-payment-retries...origin/me/fix-payment-retries [ahead 2]",
  " M apps/web/lib/payments/retry.ts",
  "M  apps/web/lib/payments/webhook.ts",
  "A  packages/lib/backoff.ts",
  "R  apps/web/lib/payments/charge.ts",
  "apps/web/lib/payments/charge-old.ts",
  "?? apps/web/lib/payments/retry.test.ts",
].join("\0");

const NUMSTAT = ["14\t3\tapps/web/lib/payments/retry.ts", "22\t9\tapps/web/lib/payments/webhook.ts", "41\t0\tpackages/lib/backoff.ts", "2\t2\tapps/web/lib/payments/{charge-old.ts => charge.ts}"].join("\n");

const DIFF = `diff --git a/apps/web/lib/payments/retry.ts b/apps/web/lib/payments/retry.ts
index 3f1c2a0..9b7e4d1 100644
--- a/apps/web/lib/payments/retry.ts
+++ b/apps/web/lib/payments/retry.ts
@@ -1,12 +1,23 @@
-import { charge } from "./charge";
+import { backoff } from "@shop/lib/backoff";
+import { charge, ChargeError } from "./charge";

 export async function chargeWithRetry(orderId: number, amount: number) {
-  return charge(orderId, amount);
+  let attempt = 0;
+  for (;;) {
+    try {
+      return await charge(orderId, amount);
+    } catch (err) {
+      if (!(err instanceof ChargeError) || !err.retryable || attempt >= 3) throw err;
+      await backoff(attempt++);
+    }
+  }
 }

 export function isRetryable(status: number) {
-  return status >= 500;
+  // 429s come back when the provider rate limits a burst of checkouts.
+  return status === 429 || status >= 500;
 }
@@ -40,6 +51,9 @@ export function describeFailure(err: unknown) {
   if (err instanceof ChargeError) {
     return err.message;
   }
+  if (err instanceof TypeError) {
+    return "The charge request never left this server.";
+  }
   return "Unknown error";
 }
`;

const PR = {
  number: 9041,
  title: "fix(payments): retry declined charges with backoff",
  state: "OPEN",
  isDraft: false,
  url: "https://github.com/acme/shop/pull/9041",
  author: { login: "me" },
  reviewDecision: "REVIEW_REQUIRED",
  headRefName: "me/fix-payment-retries",
  baseRefName: "main",
  additions: 79,
  deletions: 14,
  changedFiles: 5,
  updatedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  reviews: [
    { author: { login: "codex-review" }, state: "COMMENTED", submittedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
    { author: { login: "bailey" }, state: "CHANGES_REQUESTED", submittedAt: new Date(Date.now() - 1000 * 60 * 25).toISOString() },
  ],
  comments: [
    { author: { login: "bailey" }, body: "Can we cap the total retry time too? A slow provider outage would hold the order lock for ages.", createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString() },
    { author: { login: "me" }, body: "Good call, capping at 30s overall and surfacing a 'payment pending' state instead.", createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
  ],
  statusCheckRollup: [
    { __typename: "CheckRun", name: "Type check", workflowName: "PR", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/shop/actions/runs/1" },
    { __typename: "CheckRun", name: "Unit tests", workflowName: "PR", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://github.com/acme/shop/actions/runs/2" },
    { __typename: "CheckRun", name: "E2E (3/4)", workflowName: "E2E", status: "IN_PROGRESS", conclusion: "", detailsUrl: "https://github.com/acme/shop/actions/runs/3" },
    { __typename: "CheckRun", name: "Lint", workflowName: "PR", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "StatusContext", context: "preview", state: "SUCCESS", targetUrl: "https://preview.example.com" },
  ],
};

function decodeBase64(b64: string) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function mockShell(box: string, location: string, command: string): ExecResult | undefined {
  const home = mockHomeExec(location, command);
  if (home) return home;
  const issues = mockIssues(command);
  if (issues) return issues;
  const diff = mockDiff(location, command);
  if (diff) return diff;
  // A Compare tab's numbers for each side.
  if (command.includes("# berth-compare-stat")) {
    if (!location.includes("/")) return { exit_code: 0, output: "" };
    return { exit_code: 0, output: location.includes("search") ? " 6 files changed, 214 insertions(+), 97 deletions(-)\n" : " 24 files changed, 2389 insertions(+), 33 deletions(-)\n" };
  }
  const key = `${box}:${location}`;
  // Main checkouts are clean; worktrees have work in them.
  const clean = !location.includes("/");
  if (command.startsWith("git status --porcelain=v1 -b -z")) {
    if (clean) return { exit_code: 0, output: `## main...origin/main\0\n--berth-numstat--\n` };
    return { exit_code: 0, output: `${STATUS}\0\n--berth-numstat--\n${NUMSTAT}\n` };
  }
  if (command.startsWith("git diff --no-color")) return { exit_code: 0, output: DIFF };
  if (command.startsWith("git log -1")) return { exit_code: 0, output: "fix(payments): retry declined charges with backoff\n" };
  if (command.startsWith("git add -A && git commit")) return { exit_code: 0, output: "" };
  if (command.startsWith("git push")) return { exit_code: 0, output: "To github.com:acme/shop.git\n * [new branch]  HEAD -> me/fix-payment-retries\n" };
  if (command.startsWith("gh pr view")) {
    if (/\/(checkout|search)/.test(location)) return { exit_code: 0, output: JSON.stringify(PR) };
    if (box === "gpu") return { exit_code: 127, output: "sh: gh: command not found\n" };
    return { exit_code: 1, output: `no pull requests found for branch "${location.split("/")[1] ?? "main"}"\n` };
  }
  if (command.includes("gh pr create")) return { exit_code: 0, output: "https://github.com/acme/shop/pull/9042\n" };
  if (command.startsWith("cat .berth/notes.md")) return { exit_code: 0, output: notes.get(key) ?? "" };
  const save = /printf %s '([A-Za-z0-9+/=]*)' \| base64 -d > \.berth\/notes\.md/.exec(command);
  if (save) {
    notes.set(key, decodeBase64(save[1]));
    return { exit_code: 0, output: "" };
  }
  return undefined;
}
