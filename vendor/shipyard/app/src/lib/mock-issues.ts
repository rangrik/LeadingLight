import type { ExecResult } from "@/lib/api";

// mockIssues answers the gh calls the Issues plugin makes (an issue list and
// an issue thread through `gh api graphql`, and `gh issue comment`), so it
// can be explored with ?mock=1. Every issue here is invented. Comments
// "posted" here only ever land in this file's memory.

interface Fixture {
  number: number;
  title: string;
  author: string;
  days: number;
  updated: number;
  labels: string[];
  assignees: string[];
  body: string;
  comments: { author: string; hours: number; body: string }[];
  prs?: { number: number; state: "OPEN" | "MERGED" | "CLOSED"; draft?: boolean; title: string }[];
}

const COLORS: Record<string, string> = {
  bug: "d73a4a",
  "good first issue": "7057ff",
  checkout: "0e8a16",
  search: "1d76db",
  performance: "fbca04",
  docs: "0075ca",
  "needs repro": "e4e669",
  payments: "c5def5",
  a11y: "bfd4f2",
  "help wanted": "008672",
  infra: "5319e7",
};

const VIEWER = "me";

const ISSUES: Record<string, Fixture[]> = {
  "acme/shop": [
    {
      number: 18204,
      title: "Login loops after password reset",
      author: "ana-ng",
      days: 3,
      updated: 0.4,
      labels: ["bug", "needs repro"],
      assignees: [],
      body: [
        "### What happens",
        "",
        "After resetting a password from the email link, signing in sends you straight back to `/account/login` with no error. It happens on every try until the session cookie is cleared by hand.",
        "",
        "### Steps",
        "",
        "1. Ask for a reset link on `/account/forgot-password`",
        "2. Set a new password",
        "3. Sign in with it",
        "",
        "### Expected",
        "",
        "Signed in and on `/account/orders`.",
        "",
        "<!-- Please include your browser and version -->",
        "Seen on two browsers, not on a third. Possibly the stale session cookie from before the reset.",
      ].join("\n"),
      comments: [
        { author: "tomas-r", hours: 50, body: "Can reproduce on a fresh local install. The old session isn't invalidated when the password changes, and the new sign-in races it." },
        { author: VIEWER, hours: 30, body: "Looks like `invalidateSessions` only runs for the password change in Account settings, not for the reset flow. Should be a one-liner in the reset handler plus a test." },
      ],
    },
    {
      number: 18197,
      title: "Discount codes are ignored when the cart has a gift card",
      author: "mira-k",
      days: 6,
      updated: 1.2,
      labels: ["bug", "checkout"],
      assignees: [VIEWER],
      body: "When the cart holds a gift card and a normal product, a valid discount code is accepted but never applied to the total.\n\n```ts\n// apps/web/lib/checkout/applyDiscount.ts\nconst eligible = cart.items.every((item) => item.kind === \"product\");\n```\n\nThe check rejects the whole cart instead of skipping the gift card.",
      comments: [{ author: "ana-ng", hours: 70, body: "Confirmed with a test order. Removing the gift card makes the code apply again." }],
      prs: [{ number: 18211, state: "OPEN", draft: true, title: "fix: apply discounts to every eligible item in the cart" }],
    },
    {
      number: 18190,
      title: "Product page takes 4s to become interactive on slow 3G",
      author: "devon-p",
      days: 9,
      updated: 2,
      labels: ["performance", "search"],
      assignees: [],
      body: "A throttled run on a product page, slow 3G:\n\n| Metric | Now | Target |\n| --- | --- | --- |\n| TTI | 4.1s | < 2.5s |\n| JS | 612 KB | < 350 KB |\n\nMost of it is the image gallery and the reviews widget loading eagerly.\n\n- [x] Measure\n- [ ] Lazy-load the gallery\n- [ ] Split the reviews bundle",
      comments: [],
    },
    {
      number: 18185,
      title: "Document the webhook payload for order.refunded",
      author: "lee-w",
      days: 12,
      updated: 4,
      labels: ["docs", "good first issue"],
      assignees: [],
      body: "The docs list the payload for `order.created` and `order.cancelled`, but not for `order.refunded`, which carries `refundId` and the amount refunded.",
      comments: [{ author: "sam-q", hours: 200, body: "I'd like to take this one if nobody has started." }],
    },
    {
      number: 18172,
      title: "Partial refunds refund the whole order",
      author: "priya-v",
      days: 15,
      updated: 5,
      labels: ["bug", "payments"],
      assignees: ["tomas-r"],
      body: "Refunding one item of an order with several items refunds **every** item. Only the chosen item should be refunded.",
      comments: [
        { author: "tomas-r", hours: 300, body: "Found it: the refund looks up payments by `orderId`, and every item shares one payment." },
        { author: "priya-v", hours: 280, body: "Thanks, that matches what we saw in the admin." },
      ],
      prs: [{ number: 18180, state: "MERGED", title: "fix(payments): refund only the chosen items" }],
    },
    {
      number: 18166,
      title: "Size buttons can't be reached with the keyboard",
      author: "nadia-o",
      days: 19,
      updated: 8,
      labels: ["a11y", "help wanted"],
      assignees: [],
      body: "Tabbing through a product page skips the size buttons. They are `div`s with click handlers.",
      comments: [],
    },
    {
      number: 18151,
      title: "Add a product feed per category",
      author: "felix-b",
      days: 24,
      updated: 11,
      labels: ["search"],
      assignees: [VIEWER],
      body: "A read-only feed URL per category so partners can follow just one kind of product.",
      comments: [
        { author: VIEWER, hours: 400, body: "Plan: a signed URL per category, served from the API with a 5 minute cache." },
        { author: "felix-b", hours: 380, body: "Signed URLs sound right. Would the token rotate when the category is hidden?" },
        { author: VIEWER, hours: 360, body: "Yes, it'd be derived from the category's secret, so hiding it and showing it again rotates it." },
      ],
    },
    {
      number: 18140,
      title: "Flaky: e2e/cart-limits.spec.ts times out on CI",
      author: "ci-bot",
      days: 30,
      updated: 14,
      labels: ["infra"],
      assignees: [],
      body: "Fails roughly one run in eight on `main` with `Timeout 30000ms exceeded` waiting for the third item.",
      comments: [],
    },
  ],
  "me/notes": [
    {
      number: 412,
      title: "Rotate the staging database credentials monthly",
      author: "ops-team",
      days: 8,
      updated: 3,
      labels: ["infra"],
      assignees: [],
      body: "Automate the monthly rotation and update the secrets store in the same job.",
      comments: [],
    },
    {
      number: 409,
      title: "Seed script leaves orphaned memberships",
      author: "mira-k",
      days: 20,
      updated: 9,
      labels: ["bug"],
      assignees: [VIEWER],
      body: "Running `pnpm db:seed` twice leaves memberships pointing at deleted teams.",
      comments: [{ author: "devon-p", hours: 120, body: "Same here; `pnpm db:reset` first works around it." }],
    },
  ],
};

const iso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const label = (name: string) => ({ name, color: COLORS[name] ?? "ededed" });

function issueOf(f: Fixture) {
  return {
    number: f.number,
    title: f.title,
    author: f.author,
    createdAt: iso(f.days),
    updatedAt: iso(f.updated),
    labels: f.labels.map(label),
    assignees: f.assignees,
    comments: f.comments.length,
    prs: (f.prs ?? []).map((p) => ({ number: p.number, state: p.state, draft: !!p.draft })),
  };
}

// The title the resolver names a worktree after, for an issue here.
export function mockIssueTitle(n: number): string | undefined {
  for (const list of Object.values(ISSUES)) {
    const f = list.find((x) => x.number === n);
    if (f) return f.title;
  }
  return undefined;
}

const arg = (command: string, name: string) => new RegExp(`-[fF] ${name}='?([^' ]+)'?`).exec(command)?.[1];

export function mockIssues(command: string): ExecResult | undefined {
  if (command.startsWith("gh api graphql") && command.includes("issues(first:100")) {
    const repo = `${arg(command, "owner")}/${arg(command, "name")}`;
    const list = ISSUES[repo];
    if (!list) return { exit_code: 0, output: JSON.stringify({ viewer: VIEWER, repo, enabled: false, total: 0, issues: [] }) };
    return { exit_code: 0, output: JSON.stringify({ viewer: VIEWER, repo, enabled: true, total: list.length, issues: list.map(issueOf) }) };
  }
  if (command.startsWith("gh api graphql") && command.includes("issue(number:$number)")) {
    const repo = `${arg(command, "owner")}/${arg(command, "name")}`;
    const n = Number(arg(command, "number"));
    const f = ISSUES[repo]?.find((x) => x.number === n);
    if (!f) return { exit_code: 1, output: `gh: Could not resolve to an issue or pull request with the number of ${n}.\n` };
    return {
      exit_code: 0,
      output: JSON.stringify({
        ...issueOf(f),
        url: `https://github.com/${repo}/issues/${n}`,
        state: "OPEN",
        body: f.body,
        totalComments: f.comments.length,
        comments: f.comments.map((c, i) => ({ author: c.author, body: c.body, createdAt: new Date(Date.now() - c.hours * 3_600_000).toISOString(), url: `https://github.com/${repo}/issues/${n}#issuecomment-${n}${i}` })),
        prs: (f.prs ?? []).map((p) => ({ ...p, draft: !!p.draft, url: `https://github.com/${repo}/pull/${p.number}` })),
      }),
    };
  }
  const comment = /printf %s '([A-Za-z0-9+/=]*)' \| base64 -d \| gh issue comment (\d+) --repo '([^']+)'/.exec(command);
  if (comment) {
    const f = ISSUES[comment[3]]?.find((x) => x.number === Number(comment[2]));
    if (!f) return { exit_code: 1, output: "GraphQL: Could not resolve to an issue.\n" };
    const bytes = Uint8Array.from(atob(comment[1]), (c) => c.charCodeAt(0));
    f.comments.push({ author: VIEWER, hours: 0, body: new TextDecoder().decode(bytes) });
    f.updated = 0;
    return { exit_code: 0, output: `https://github.com/${comment[3]}/issues/${f.number}#issuecomment-1\n` };
  }
  return undefined;
}
