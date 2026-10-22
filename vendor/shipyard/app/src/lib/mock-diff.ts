import type { ExecResult } from "@/lib/api";

// mockDiff answers the Diff plugin's script (plugins/diff/src/git.ts) with a
// realistic branch: a payments fix with tests, a renamed and a deleted file,
// a lockfile, a large fixture, a binary image and a batch of locale files.
// Main checkouts have nothing on their branch and nothing uncommitted.

type Line = string; // " ctx", "+add", "-del"

function hunk(oldStart: number, newStart: number, lines: Line[], context = "") {
  const old = lines.filter((l) => l[0] !== "+").length;
  const now = lines.filter((l) => l[0] !== "-").length;
  return `@@ -${old ? oldStart : 0},${old} +${now ? newStart : 0},${now} @@${context ? ` ${context}` : ""}\n${lines.join("\n")}\n`;
}

interface MockFile {
  path: string;
  from?: string;
  kind: "mod" | "add" | "del" | "ren" | "bin";
  hunks?: string[];
}

function patchOf(f: MockFile) {
  const a = f.from ?? f.path;
  let head = `diff --git a/${a} b/${f.path}\n`;
  if (f.kind === "add") head += "new file mode 100644\nindex 0000000..4b1f2c9\n--- /dev/null\n";
  else if (f.kind === "del") head += `deleted file mode 100644\nindex 7d2e1a0..0000000\n--- a/${a}\n`;
  else if (f.kind === "ren") head += `similarity index 91%\nrename from ${a}\nrename to ${f.path}\nindex 1c9e0d2..8a7f3b4 100644\n--- a/${a}\n`;
  else if (f.kind === "bin") return `${head}index 3a4b5c6..9d8e7f0 100644\nBinary files a/${a} and b/${f.path} differ\n`;
  else head += `index 3f1c2a0..9b7e4d1 100644\n--- a/${a}\n`;
  head += f.kind === "del" ? "+++ /dev/null\n" : `+++ b/${f.path}\n`;
  return head + (f.hunks ?? []).join("");
}

function numstatOf(f: MockFile) {
  if (f.kind === "bin") return `-\t-\t${f.path}\0`;
  let added = 0;
  let removed = 0;
  for (const h of f.hunks ?? []) {
    for (const l of h.split("\n").slice(1)) {
      if (l[0] === "+") added++;
      else if (l[0] === "-") removed++;
    }
  }
  return f.from ? `${added}\t${removed}\t\0${f.from}\0${f.path}\0` : `${added}\t${removed}\t${f.path}\0`;
}

const added = (lines: string[]) => [hunk(0, 1, lines.map((l) => `+${l}`))];
const removed = (lines: string[]) => [hunk(1, 0, lines.map((l) => `-${l}`))];

const RETRY: MockFile = {
  path: "apps/web/lib/payments/retry.ts",
  kind: "mod",
  hunks: [
    hunk(1, 1, [
      '-import { charge } from "./charge";',
      '+import { backoff } from "@shop/lib/backoff";',
      '+import { charge, ChargeError } from "./charge";',
      "+",
      "+const MAX_ATTEMPTS = 3;",
      "+// A slow provider outage must not hold the order lock for minutes.",
      "+const MAX_TOTAL_MS = 30_000;",
      " ",
      " export async function chargeWithRetry(orderId: number, amount: number) {",
      "-  return charge(orderId, amount);",
      "+  const started = Date.now();",
      "+  let attempt = 0;",
      "+  for (;;) {",
      "+    try {",
      "+      return await charge(orderId, amount);",
      "+    } catch (err) {",
      "+      const late = Date.now() - started > MAX_TOTAL_MS;",
      "+      if (!(err instanceof ChargeError) || !err.retryable || attempt >= MAX_ATTEMPTS || late) throw err;",
      "+      await backoff(attempt++);",
      "+    }",
      "+  }",
      " }",
      " ",
      " export function isRetryable(status: number) {",
      "-  return status >= 500;",
      "+  // 429s come back when the provider rate limits a burst of checkouts.",
      "+  return status === 429 || status >= 500;",
      " }",
    ]),
    hunk(40, 58, [
      "   if (err instanceof ChargeError) {",
      "     return err.message;",
      "   }",
      "+  if (err instanceof TypeError) {",
      '+    return "The charge request never left this server.";',
      "+  }",
      '   return "Unknown error";',
      " }",
    ], "export function describeFailure(err: unknown) {"),
  ],
};

const WEBHOOK: MockFile = {
  path: "apps/web/lib/payments/webhook.ts",
  kind: "mod",
  hunks: [
    hunk(12, 12, [
      " export async function handleWebhook(req: Request) {",
      "   const event = await verify(req);",
      "-  if (event.type === \"charge.failed\") {",
      "-    await markFailed(event.data.orderId);",
      "-  }",
      "+  switch (event.type) {",
      '+    case "charge.failed":',
      "+      // Retries are ours now: only the last failure fails the order.",
      "+      if (!event.data.final) return ok();",
      "+      await markFailed(event.data.orderId, event.data.reason);",
      "+      break;",
      '+    case "charge.succeeded":',
      "+      await markPaid(event.data.orderId);",
      "+      break;",
      "+  }",
      "   return ok();",
      " }",
    ]),
  ],
};

const BACKOFF: MockFile = {
  path: "packages/lib/backoff.ts",
  kind: "add",
  hunks: added([
    "// backoff waits before a retry: 250ms, 500ms, 1s, 2s… with jitter, so a",
    "// burst of failed checkouts doesn't retry in lockstep.",
    "export interface BackoffOptions {",
    "  base?: number;",
    "  max?: number;",
    "  jitter?: number;",
    "}",
    "",
    "export function delayFor(attempt: number, { base = 250, max = 8_000, jitter = 0.2 }: BackoffOptions = {}) {",
    "  const exp = Math.min(max, base * 2 ** attempt);",
    "  const spread = exp * jitter;",
    "  return Math.round(exp - spread + Math.random() * spread * 2);",
    "}",
    "",
    "export function backoff(attempt: number, opts?: BackoffOptions): Promise<void> {",
    "  return new Promise((resolve) => setTimeout(resolve, delayFor(attempt, opts)));",
    "}",
  ]),
};

const BACKOFF_TEST: MockFile = {
  path: "packages/lib/backoff.test.ts",
  kind: "add",
  hunks: added([
    'import { describe, expect, it, vi } from "vitest";',
    'import { delayFor } from "./backoff";',
    "",
    'describe("delayFor", () => {',
    '  it("doubles each attempt", () => {',
    '    vi.spyOn(Math, "random").mockReturnValue(0.5);',
    "    expect([0, 1, 2, 3].map((n) => delayFor(n))).toEqual([250, 500, 1000, 2000]);",
    "  });",
    "",
    '  it("never waits longer than max", () => {',
    "    expect(delayFor(20, { jitter: 0 })).toBe(8000);",
    "  });",
    "});",
  ]),
};

const CHARGE: MockFile = {
  path: "apps/web/lib/payments/charge.ts",
  from: "apps/web/lib/payments/charge-old.ts",
  kind: "ren",
  hunks: [
    hunk(3, 3, [
      " export class ChargeError extends Error {",
      "-  constructor(message: string, readonly status: number) {",
      "+  constructor(message: string, readonly status: number, readonly retryable = isRetryable(status)) {",
      "     super(message);",
      "   }",
      " }",
    ]),
  ],
};

const LEGACY: MockFile = {
  path: "apps/web/lib/payments/legacy-retry.ts",
  kind: "del",
  hunks: removed([
    "// Deprecated: retried every failure three times, declines included.",
    'import { charge } from "./charge-old";',
    "",
    "export async function legacyRetry(orderId: number, amount: number) {",
    "  for (let i = 0; i < 3; i++) {",
    "    try {",
    "      return await charge(orderId, amount);",
    "    } catch {}",
    "  }",
    '  throw new Error("charge failed");',
    "}",
  ]),
};

const LEDGER: MockFile = {
  path: "services/ledger/retry.go",
  kind: "mod",
  hunks: [
    hunk(18, 18, [
      " func (l *Ledger) Record(ctx context.Context, c Charge) error {",
      "-\treturn l.db.Insert(ctx, c)",
      "+\t// A retried charge carries the same idempotency key: record it once.",
      "+\tif c.IdempotencyKey != \"\" {",
      "+\t\tif ok, err := l.db.Exists(ctx, c.IdempotencyKey); err != nil || ok {",
      "+\t\t\treturn err",
      "+\t\t}",
      "+\t}",
      "+\treturn l.db.Insert(ctx, c)",
      " }",
    ]),
  ],
};

const PAGE: MockFile = {
  path: "apps/web/app/checkout/page.tsx",
  kind: "mod",
  hunks: [
    hunk(31, 31, [
      "   return (",
      '     <form action={pay} className="space-y-4">',
      "       <OrderSummary order={order} />",
      "-      {error && <p className=\"text-red-600\">{error}</p>}",
      "+      {error && (",
      '+        <Alert variant="destructive">',
      "+          <AlertTitle>Payment didn't go through</AlertTitle>",
      "+          <AlertDescription>{describeFailure(error)}</AlertDescription>",
      "+        </Alert>",
      "+      )}",
      '       <Button type="submit" loading={pending}>',
      "         Pay {formatMoney(order.total)}",
      "       </Button>",
    ], "export default function CheckoutPage({ order }: Props) {"),
  ],
};

const DOCS: MockFile = {
  path: "docs/payments.md",
  kind: "mod",
  hunks: [
    hunk(8, 8, [
      " ## Failed charges",
      " ",
      "-A failed charge fails the order.",
      "+A failed charge is retried up to three times with backoff (250ms, 500ms,",
      "+1s, with jitter) when the provider says it may succeed: rate limits (429)",
      "+and server errors (5xx). Declines are never retried.",
      "+",
      "+Retries stop after 30 seconds in all, and the order shows *payment pending*",
      "+until the webhook settles it.",
    ]),
  ],
};

const IMAGE: MockFile = { path: "apps/web/public/receipts/declined.png", kind: "bin" };

// A lockfile change of a few hundred lines: starts folded.
const LOCK: MockFile = {
  path: "pnpm-lock.yaml",
  kind: "mod",
  hunks: [
    hunk(
      1204,
      1204,
      [
        "   /@shop/lib@workspace:packages/lib:",
        "     dependencies:",
        "+      p-retry: 6.2.1",
        ...Array.from({ length: 160 }, (_, i) => [
          `+  /retry-dep-${i}@${1 + (i % 4)}.${i % 10}.${(i * 7) % 13}:`,
          `+    resolution: {integrity: sha512-${btoa(`dep-${i}-integrity-hash-for-mock`).slice(0, 40)}}`,
          "+    engines: {node: '>=18'}",
        ]).flat(),
        "   /typescript@5.6.3:",
      ],
    ),
  ],
};

// A large generated fixture: starts folded.
const FIXTURE: MockFile = {
  path: "apps/web/lib/payments/fixtures/decline-codes.json",
  kind: "add",
  hunks: added([
    "[",
    ...Array.from({ length: 1800 }, (_, i) => `  { "code": "${["card_declined", "insufficient_funds", "rate_limited", "processing_error", "expired_card"][i % 5]}_${i}", "retryable": ${i % 5 === 2 || i % 5 === 3}, "status": ${[402, 402, 429, 502, 402][i % 5]} }${i === 1799 ? "" : ","}`),
    "]",
  ]),
};

const LOCALES = ["de", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt-BR", "sv", "tr", "zh-CN"].map<MockFile>((l, i) => ({
  path: `apps/web/locales/${l}/payments.json`,
  kind: "mod",
  hunks: [
    hunk(14 + i, 14 + i, [
      `   "pay": "${["Bezahlen", "Pagar", "Payer", "Paga", "支払う", "결제", "Betalen", "Zapłać", "Pagar", "Betala", "Öde", "支付"][i]}",`,
      `-  "failed": "${["Zahlung fehlgeschlagen", "Pago fallido", "Paiement échoué", "Pagamento non riuscito", "支払いに失敗しました", "결제 실패", "Betaling mislukt", "Płatność nieudana", "Pagamento falhou", "Betalningen misslyckades", "Ödeme başarısız", "支付失败"][i]}"`,
      `+  "failed": "${["Zahlung fehlgeschlagen", "Pago fallido", "Paiement échoué", "Pagamento non riuscito", "支払いに失敗しました", "결제 실패", "Betaling mislukt", "Płatność nieudana", "Pagamento falhou", "Betalningen misslyckades", "Ödeme başarısız", "支付失败"][i]}",`,
      `+  "pending": "${["Zahlung ausstehend", "Pago pendiente", "Paiement en attente", "Pagamento in sospeso", "支払い保留中", "결제 대기 중", "Betaling in behandeling", "Płatność w toku", "Pagamento pendente", "Betalning väntar", "Ödeme bekleniyor", "支付处理中"][i]}"`,
      " }",
    ]),
  ],
}));

const RETRY_TEST: MockFile = {
  path: "apps/web/lib/payments/retry.test.ts",
  kind: "add",
  hunks: added([
    'import { describe, expect, it, vi } from "vitest";',
    'import { ChargeError } from "./charge";',
    'import { chargeWithRetry } from "./retry";',
    "",
    'vi.mock("./charge");',
    "",
    'describe("chargeWithRetry", () => {',
    '  it("gives up after three retryable failures", async () => {',
    '    const err = new ChargeError("rate limited", 429);',
    "    vi.mocked(charge).mockRejectedValue(err);",
    "    await expect(chargeWithRetry(1, 4200)).rejects.toBe(err);",
    "    expect(charge).toHaveBeenCalledTimes(4);",
    "  });",
    "});",
  ]),
};

// What isn't committed: one more change to retry.ts, and its new test.
const RETRY_WIP: MockFile = {
  path: "apps/web/lib/payments/retry.ts",
  kind: "mod",
  hunks: [
    hunk(3, 3, [
      " ",
      "-const MAX_ATTEMPTS = 3;",
      "+const MAX_ATTEMPTS = Number(process.env.CHARGE_MAX_ATTEMPTS ?? 3);",
      " // A slow provider outage must not hold the order lock for minutes.",
    ]),
  ],
};

// The search-perf worktree's own branch: a trigram index and a cache.
const SEARCH: MockFile[] = [
  {
    path: "apps/web/lib/search/query.ts",
    kind: "mod",
    hunks: [
      hunk(1, 1, [
        ' import { db } from "@shop/db";',
        '+import { cached } from "@shop/lib/cache";',
        " ",
        "-export async function searchProducts(q: string, limit = 48) {",
        "-  const rows = await db.product.findMany({ where: { name: { contains: q, mode: \"insensitive\" } } });",
        "-  return rows.slice(0, limit);",
        "+export const searchProducts = cached(60, async (q: string, limit = 48) => {",
        "+  // The trigram index answers ILIKE without a full scan (612 ms → 38 ms).",
        "+  return db.$queryRaw`SELECT id, name, price FROM product WHERE name % ${q} ORDER BY similarity(name, ${q}) DESC LIMIT ${limit}`;",
        "+});",
        " ",
        " export function normalise(q: string) {",
        "   return q.trim().toLowerCase();",
      ]),
    ],
  },
  {
    path: "packages/db/migrations/0042_product_name_trgm.sql",
    kind: "add",
    hunks: added(["CREATE EXTENSION IF NOT EXISTS pg_trgm;", "CREATE INDEX CONCURRENTLY product_name_trgm ON product USING gin (name gin_trgm_ops);"]),
  },
  {
    path: "packages/lib/cache.ts",
    kind: "add",
    hunks: added([
      "const store = new Map<string, { at: number; value: unknown }>();",
      "",
      "export function cached<A extends unknown[], R>(seconds: number, fn: (...args: A) => Promise<R>) {",
      "  return async (...args: A): Promise<R> => {",
      "    const key = JSON.stringify(args);",
      "    const hit = store.get(key);",
      "    if (hit && Date.now() - hit.at < seconds * 1000) return hit.value as R;",
      "    const value = await fn(...args);",
      "    store.set(key, { at: Date.now(), value });",
      "    return value;",
      "  };",
      "}",
    ]),
  },
  {
    path: "apps/web/app/search/page.tsx",
    kind: "mod",
    hunks: [
      hunk(12, 12, [
        "   const results = await searchProducts(normalise(q));",
        "-  return <Results items={results} />;",
        '+  return <Results items={results} took={performance.now() - started} />;',
        " }",
      ]),
    ],
  },
];

const BRANCH = [RETRY, WEBHOOK, CHARGE, LEGACY, IMAGE, PAGE, FIXTURE, ...LOCALES, BACKOFF, BACKOFF_TEST, LEDGER, DOCS, LOCK];

function filesFor(scope: string, clean: boolean): MockFile[] {
  if (clean) return [];
  if (scope === "uncommitted") return [RETRY_WIP, RETRY_TEST];
  if (scope === "all") return [...BRANCH, RETRY_TEST];
  return BRANCH;
}

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(bin), size: bytes.length };
}

export function mockDiff(location: string, command: string): ExecResult | undefined {
  const m = /berth-diff (branch|uncommitted|all) \d+/.exec(command);
  if (!m) return undefined;
  const clean = !location.includes("/");
  const search = location.includes("search-perf");
  const branch = clean ? "main" : search ? "me/search-perf" : "me/fix-payment-retries";
  const files = search ? SEARCH : filesFor(m[1], clean);
  const payload = `branch\t${branch}\nbase\torigin/main\nmergebase\t4e8c1d2a9b7f6e5d3c2b1a0f9e8d7c6b5a4f3e2d\n--numstat--\n${files.map(numstatOf).join("")}\n--patch--\n${files.map(patchOf).join("")}`;
  const { b64, size } = toBase64(payload);
  return { exit_code: 0, output: `@@berth-diff ok /tmp/berth-diff.mock raw ${size}\n${b64}\n` };
}
