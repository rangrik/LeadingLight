import { isNative } from "~/lib/platform";
import { createStore } from "~/lib/state";

// How much of each plan is used (features/usage.feature): Claude's from Claude Code's own
// /usage, Codex's from its app server (src-tauri), so no sign-in secret is read here. In a
// browser build a stand-in answers; ?usage=out and ?usage=signed-out show those states.

export type Limit = { label: string; used: number; resetsAt: number | null; minutes: number };
export type Plan = { id: "claude" | "codex"; name: string; plan: string | null; state: "ok" | "signed-out" | "missing" | "error"; limits: Limit[]; credits?: string; note?: string };
export const usage = createStore<{ plans: Plan[]; checked: number; checking: boolean }>({ plans: [], checked: 0, checking: false });

const H = 60;
const WEEK = 7 * 24 * H;
const titled = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : null);
const windowName = (m: number) => (m === 5 * H ? "5h" : m === WEEK ? "Weekly" : m % (24 * H) === 0 ? `${m / (24 * H)}d` : `${Math.round(m / H)}h`);
const pct = (used: number | null | undefined) => Math.max(0, Math.min(100, used ?? 0));
const when = (iso?: string | null) => (iso ? Date.parse(iso) : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function claudePlan(r: Json): Plan {
  const base = { id: "claude" as const, name: "Claude", plan: titled(r?.subscription_type), limits: [] };
  const rl = r?.rate_limits;
  if (!r?.rate_limits_available || !rl) return { ...base, state: "signed-out", note: "Sign in with claude auth login to see usage." };
  const kinds: Record<string, [string, number]> = { session: ["5h", 5 * H], weekly_all: ["Weekly", WEEK] };
  const listed: Limit[] = (rl.limits ?? []).flatMap((l: Json) => {
    const [label, minutes] = l.kind === "weekly_scoped" ? [l.scope?.model?.display_name ?? "Model", WEEK] : (kinds[l.kind] ?? []);
    return label ? [{ label, used: pct(l.percent), resetsAt: when(l.resets_at), minutes }] : [];
  });
  const old: Limit[] = [
    ...(rl.five_hour ? [{ label: "5h", used: pct(rl.five_hour.utilization), resetsAt: when(rl.five_hour.resets_at), minutes: 5 * H }] : []),
    ...(rl.seven_day ? [{ label: "Weekly", used: pct(rl.seven_day.utilization), resetsAt: when(rl.seven_day.resets_at), minutes: WEEK }] : []),
  ];
  return { ...base, state: "ok", limits: listed.length ? listed : old };
}

function codexPlan(r: Json): Plan {
  const account = r?.account?.result?.account;
  const base = { id: "codex" as const, name: "Codex", plan: titled(account?.planType), limits: [] };
  if (!account) return { ...base, state: "signed-out", note: "Sign in with codex login to see usage." };
  const rl = r?.limits?.result?.rateLimits;
  const windows = [rl?.secondary, rl?.primary].filter(Boolean) as Json[];
  const limits = windows
    .map((w) => ({ label: windowName(w.windowDurationMins), used: pct(w.usedPercent), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null, minutes: w.windowDurationMins }))
    .sort((a, b) => a.minutes - b.minutes);
  const credits = rl?.credits?.hasCredits && !rl.credits.unlimited ? `${Math.round(Number(rl.credits.balance)).toLocaleString()} credits for use past the limits` : undefined;
  return { ...base, state: "ok", limits, credits };
}

function standIn(): Json[] {
  const mode = new URLSearchParams(location.search).get("usage");
  const cx = new URLSearchParams(location.search).get("codex");
  const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  if (mode === "signed-out") return [{ rate_limits_available: false, rate_limits: null }, { account: { result: { account: null } } }];
  return [
    {
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        limits: [
          { kind: "session", percent: mode === "out" ? 96 : 14, resets_at: at(59) },
          { kind: "weekly_all", percent: 39, resets_at: at(41 * H) },
          { kind: "weekly_scoped", percent: 29, resets_at: at(41 * H), scope: { model: { display_name: "Fable" } } },
        ],
      },
    },
    cx === "missing" ? null : {
      account: { result: { account: cx === "signed-out" ? null : { type: "chatgpt", planType: "pro" } } },
      limits: { result: { rateLimits: { primary: { usedPercent: 4, windowDurationMins: WEEK, resetsAt: Math.round(Date.now() / 1000) + 146 * 3600 }, secondary: null, credits: { hasCredits: true, unlimited: false, balance: "62500" } } } },
    },
  ];
}

async function read(): Promise<Plan[]> {
  if (!(await isNative)) {
    if (!import.meta.env.DEV) return [];
    const [c, x] = standIn();
    return [claudePlan(c), x ? codexPlan(x) : { id: "codex", name: "Codex", plan: null, limits: [], state: "missing", note: "Codex is not installed." }];
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const failed = (id: Plan["id"], name: string) => (e: unknown): Plan => {
    const note = String(e);
    return { id, name, plan: null, limits: [], state: /not installed/i.test(note) ? "missing" : "error", note: /not installed/i.test(note) ? `${name === "Claude" ? "Claude Code" : name} is not installed.` : note };
  };
  return Promise.all([
    invoke("agent_usage").then(claudePlan, failed("claude", "Claude")),
    invoke("codex_usage").then(codexPlan, failed("codex", "Codex")),
  ]);
}

// At most once a minute unless asked; a check that fails keeps the numbers it had.
export async function refreshUsage(force = false) {
  const s = usage.get();
  if (s.checking || (!force && Date.now() - s.checked < 60_000)) return;
  usage.set({ ...s, checking: true });
  const next = await read();
  const plans = next.map((p) => {
    const was = s.plans.find((o) => o.id === p.id);
    return p.state === "error" && was?.state === "ok" ? { ...was, note: "Couldn't check just now; these numbers are from the last check." } : p;
  });
  usage.set({ plans, checked: Date.now(), checking: false });
}

// The pace, after synara: what an even pace would have used by now (the tick), how far over or
// under that, and whether at this rate the limit lasts until it resets.
export function pace(l: Limit, now = Date.now()) {
  if (!l.resetsAt) return null;
  const span = l.minutes * 60_000;
  const elapsed = Math.min(1, Math.max((now - (l.resetsAt - span)) / span, 0.05));
  const used = l.used;
  const expected = elapsed * 100;
  const projected = used === 0 ? 0 : used / elapsed;
  const status = used >= 100 ? "behind" : used === 0 || projected <= 80 ? "ahead" : projected <= 100 ? "on-track" : "behind";
  const delta = Math.round(used - expected);
  const outIn = used > 0 ? (100 - used) / (projected / span) : Number.POSITIVE_INFINITY;
  const eta = used >= 100 ? "Limit reached" : status === "behind" && now + outIn < l.resetsAt ? `Runs out in ${duration(outIn)}` : "Lasts until reset";
  return { tick: expected, status, gap: delta > 0 ? `${delta}% in deficit` : `${-delta}% in reserve`, eta };
}

export function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export const resetText = (l: Limit, now = Date.now()) => (l.resetsAt && l.resetsAt - now > 60_000 ? `Resets in ${duration(l.resetsAt - now)}` : "Resets soon");
