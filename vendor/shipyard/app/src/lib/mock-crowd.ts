import type { Location, Session, Stats, Status } from "@/lib/api";
import { mockSetBoxOnline } from "@/lib/mock-queue";

// ?mock=1&crowd=1: a busy day on top of the fixtures, for the parts of the
// app that have to cope with many agents at once (the folded sidebar's
// rail): two more boxes, more projects and worktrees, agents in every
// state, two in one worktree, and a box (homelab) that drops offline a
// moment after the app connects, so its agents are last seen, not known.

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const GB = 1024 ** 3;

interface Fixtures {
  status: Status;
  locations: Record<string, Location[]>;
  sessions: Record<string, Session[]>;
  stats: Record<string, Stats>;
}

const repo = (name: string, path: string, slug: string | undefined, wts: string[]): Location => ({
  name,
  path,
  repo: true,
  slug,
  remote: slug ? `git@github.com:${slug}.git` : undefined,
  default_branch: "main",
  scripts: {},
  worktrees: [{ name, path, branch: "main", main: true }, ...wts.map((w) => ({ name: w, path: `${path}-${w}`, branch: `me/${w}` }))],
});

type Agent = "claude" | "codex";
type St = "running" | "waiting" | "finished" | "idle";

function agent(loc: Location, wt: string, who: Agent, state: St, title: string | undefined, min: number, extra: Partial<Session> = {}): Session {
  const w = loc.worktrees!.find((x) => x.name === wt)!;
  return {
    name: `${wt}-${who}${extra.name ?? ""}`,
    title,
    location: w.main ? loc.name : `${loc.name}/${wt}`,
    dir: w.path,
    command: who,
    created: ago(min + 20),
    attached: 0,
    exited: false,
    agent: who,
    agent_state: state,
    state_since: ago(min),
    ...extra,
  };
}

export function crowd({ status, locations, sessions, stats }: Fixtures) {
  status.boxes.push(
    { name: "build", address: "100.64.0.31:7444", fingerprint: "sha256:b01d…", state: "online", latency_ms: 24, since: ago(400) },
    { name: "homelab", address: "100.64.0.52:7444", fingerprint: "sha256:40fe…", state: "online", latency_ms: 61, since: ago(90) },
  );
  const berth = repo("berth", "/home/me/berth", "sean/berth", ["rail-redesign", "preview-tabs", "perf-agent-slow", "omarchy-runner", "chat-polish", "docs-refresh"]);
  const infra = repo("infra", "/home/me/infra", "acme/infra", ["terraform-upgrade", "dns-cutover"]);
  locations.build = [berth, infra];
  const media = repo("media", "/srv/media", undefined, ["transcode"]);
  const ha = repo("home-assistant", "/srv/home-assistant", undefined, []);
  locations.homelab = [media, ha];
  const shop = locations.devl?.find((l) => l.name === "shop");
  if (shop) shop.worktrees?.push({ name: "stripe-v3", path: "/home/me/work/shop-stripe-v3", branch: "me/stripe-v3" });

  sessions.build = [
    agent(berth, "rail-redesign", "claude", "running", "Redesign the collapsed sidebar rail", 1),
    agent(berth, "preview-tabs", "codex", "waiting", "Show a page at every size at once", 3, { ask: { tool: "Bash", input: "pnpm test:e2e", why: "Run the smoke suite on the new preview frames" } }),
    agent(berth, "perf-agent-slow", "claude", "finished", "Find why the agent is slow to start", 12),
    agent(berth, "omarchy-runner", "claude", "running", "Set up the omarchy CI runner", 6),
    agent(berth, "chat-polish", "claude", "running", "Polish the chat components", 2),
    agent(berth, "chat-polish", "codex", "waiting", "Review the chat polish", 1, { name: "-review", ask: { tool: "AskUserQuestion", message: "Keep the old code block colours?" } }),
    agent(berth, "docs-refresh", "claude", "idle", undefined, 40),
    agent(infra, "terraform-upgrade", "codex", "running", "Upgrade Terraform to 1.9", 8),
    agent(infra, "dns-cutover", "claude", "finished", "Cut DNS over to the new load balancer", 31),
  ];
  sessions.homelab = [agent(media, "transcode", "claude", "running", "Transcode the archive to AV1", 15), agent(ha, "home-assistant", "claude", "waiting", "Add the garage door sensor", 9)];
  if (shop) sessions.devl?.push(agent(shop, "stripe-v3", "claude", "running", "Move checkout to Stripe API v3", 4));

  const box = (hostname: string): Stats => ({ hostname, cpus: 8, load: [0.8, 0.7, 0.6], memory: { total: 32 * GB, used: 12 * GB }, swap: { total: 0, used: 0 }, disks: [{ mount: "/", total: 500 * GB, used: 120 * GB }], agents: [], hooks: true });
  stats.build = box("build");
  stats.homelab = box("homelab");

  // homelab goes away once the app has seen what it runs.
  setTimeout(() => mockSetBoxOnline("homelab", false), 1500);
}
