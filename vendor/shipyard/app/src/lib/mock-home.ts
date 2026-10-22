import type { ExecResult } from "@/lib/api";

// Home's widgets in ?mock=1: the git log, GitHub search and Actions runs
// their commands ask a box for, answered with made-up but steady numbers
// (views/home/widgets, plugins/pull-request/src/home.tsx). Every name here
// is invented.

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

// A fortnight of commits: a busy repository and a quiet one.
function gitLog(location: string): string {
  const busy = location.startsWith("shop");
  const perDay = busy ? [6, 9, 4, 11, 8, 1, 0, 7, 12, 10, 14, 9, 2, 5] : [1, 0, 2, 0, 1, 0, 0, 0, 1, 3, 0, 1, 0, 2];
  const out: string[] = [];
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  perDay.forEach((n, i) => {
    const day = today.getTime() - (perDay.length - 1 - i) * DAY;
    for (let k = 0; k < n; k++) {
      const at = Math.floor((day + k * 37 * 60_000) / 1000);
      const add = ((i * 31 + k * 17) % 140) + 4;
      const del = ((i * 13 + k * 7) % 60) + 1;
      out.push(`@${at}`, "", ` ${1 + ((i + k) % 6)} files changed, ${add} insertions(+), ${del} deletions(-)`);
    }
  });
  return `${out.join("\n")}\n`;
}

const pr = (o: { number: number; repo: string; title: string; by: string; draft?: boolean; checks?: string; decision?: string | null; ago: number; add: number; del: number }) => ({
  number: o.number,
  title: o.title,
  url: `https://github.com/${o.repo}/pull/${o.number}`,
  isDraft: !!o.draft,
  updatedAt: iso(o.ago),
  additions: o.add,
  deletions: o.del,
  reviewDecision: o.decision ?? "REVIEW_REQUIRED",
  repository: { nameWithOwner: o.repo },
  author: { login: o.by },
  commits: { nodes: [{ commit: { statusCheckRollup: o.checks ? { state: o.checks } : null } }] },
});

const PRS = {
  viewer: "you",
  reviewCount: 2,
  mineCount: 4,
  review: [
    pr({ number: 1291, repo: "acme/shop", title: "Speed up product search with a trigram index", by: "ana-ng", checks: "SUCCESS", ago: 2 * 3600_000, add: 212, del: 64 }),
    pr({ number: 1293, repo: "acme/shop", title: "Add a CSV export for orders", by: "kofi-b", checks: "PENDING", ago: 35 * 60_000, add: 488, del: 31 }),
  ],
  mine: [
    pr({ number: 1287, repo: "acme/shop", title: "Retry checkout webhooks with backoff", by: "you", checks: "SUCCESS", decision: "APPROVED", ago: DAY, add: 96, del: 22 }),
    pr({ number: 1279, repo: "acme/shop", title: "Fix the flaky checkout e2e test", by: "you", checks: "FAILURE", ago: 3 * 3600_000, add: 18, del: 41 }),
    pr({ number: 64, repo: "me/notes", title: "Weekly notes template", by: "you", draft: true, checks: "PENDING", decision: null, ago: 20 * 60_000, add: 40, del: 2 }),
    pr({ number: 1270, repo: "acme/shop", title: "Dark logo for transactional emails", by: "you", checks: "SUCCESS", decision: "CHANGES_REQUESTED", ago: 2 * DAY, add: 12, del: 3 }),
  ],
};

let runId = 9000;
const run = (branch: string, workflow: string, conclusion: string, ago: number, title: string) => ({
  databaseId: ++runId,
  workflowName: workflow,
  displayTitle: title,
  headBranch: branch,
  status: "completed",
  conclusion,
  createdAt: iso(ago),
  url: `https://github.com/acme/shop/actions/runs/${runId}`,
});

function runs(location: string) {
  if (!location.startsWith("shop")) return [run("main", "CI", "success", 3 * 3600_000, "Weekly notes template")];
  return [
    run("me/ci-flake", "e2e (chromium)", "failure", 12 * 60_000, "Fix the flaky checkout e2e test"),
    run("me/ci-flake", "lint", "success", 12 * 60_000, "Fix the flaky checkout e2e test"),
    run("me/checkout-fix", "typecheck", "failure", 48 * 60_000, "Retry checkout webhooks with backoff"),
    run("me/checkout-fix", "typecheck", "success", 3 * 3600_000, "Retry checkout webhooks with backoff"),
    run("main", "CI", "success", 2 * 3600_000, "Speed up product search"),
    // Someone else's branch: not one of your worktrees, so not shown.
    run("kofi/export", "CI", "failure", 30 * 60_000, "Add a CSV export for orders"),
  ];
}

export function mockHomeExec(location: string, command: string): ExecResult | undefined {
  if (command.includes("# berth-home:git")) return { exit_code: 0, output: gitLog(location) };
  if (command.includes("# berth-home:prs")) return { exit_code: 0, output: JSON.stringify(PRS) };
  if (command.includes("# berth-home:ci")) return { exit_code: 0, output: JSON.stringify(runs(location)) };
  return undefined;
}
