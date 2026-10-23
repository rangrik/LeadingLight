import { type BerthPluginContext, type HomeWidgetProps, type Project, useBerth, useProjects, useWidgetData } from "@berth/plugin";
import { Button, Icon, Tip, WidgetEmpty, WidgetRow, WidgetSkeleton, cn } from "@berth/plugin/ui";
import { useMemo } from "react";

import { quote, since } from "./gh";

// Home widgets: your pull requests and the ones waiting on your review, in
// one GraphQL search with gh; and CI that failed on the branches of your
// worktrees, one `gh run list` per project. Both run on a box (its gh, its
// login), and only while the widget is on screen.

// ---------- what gh answers ----------

export interface HomePR {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  additions: number;
  deletions: number;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  repository: { nameWithOwner: string };
  author?: { login: string } | null;
  commits?: { nodes: { commit: { statusCheckRollup?: { state: string } | null } }[] };
}

export interface HomePRs {
  viewer: string;
  review: HomePR[];
  mine: HomePR[];
  reviewCount: number;
  mineCount: number;
}

const FIELDS = "number title url isDraft updatedAt additions deletions reviewDecision repository { nameWithOwner } author { login } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";
const PRS_QUERY = `query {
  viewer { login }
  review: search(query: "is:pr is:open archived:false review-requested:@me sort:updated-desc", type: ISSUE, first: 15) { issueCount nodes { ... on PullRequest { ${FIELDS} } } }
  mine: search(query: "is:pr is:open archived:false author:@me sort:updated-desc", type: ISSUE, first: 15) { issueCount nodes { ... on PullRequest { ${FIELDS} } } }
}`;

export const prsCommand = () => `gh api graphql -f query=${quote(PRS_QUERY)} --jq '{viewer: .data.viewer.login, review: .data.review.nodes, mine: .data.mine.nodes, reviewCount: .data.review.issueCount, mineCount: .data.mine.issueCount}' # berth-home:prs`;

export interface Run {
  databaseId: number;
  workflowName: string;
  displayTitle: string;
  headBranch: string;
  status: string;
  conclusion: string;
  createdAt: string;
  url: string;
}

export const runsCommand = () => `gh run list --limit 60 --json databaseId,workflowName,displayTitle,headBranch,status,conclusion,createdAt,url # berth-home:ci`;

// A gh failure, in words for a widget.
export class GhProblem extends Error {
  constructor(
    message: string,
    readonly kind: "no-gh" | "no-auth" | "other",
  ) {
    super(message);
  }
}

function readGh<T>(r: { exit_code: number; output: string }): T {
  const text = r.output.toLowerCase();
  if (r.exit_code === 127 || text.includes("command not found")) throw new GhProblem("gh isn't installed on the box", "no-gh");
  if (r.exit_code !== 0 && (text.includes("gh auth login") || text.includes("authentication"))) throw new GhProblem("gh isn't logged in on the box", "no-auth");
  if (r.exit_code !== 0) throw new GhProblem(r.output.trim().split("\n").pop() || `gh exited with ${r.exit_code}`, "other");
  return JSON.parse(r.output) as T;
}

// Where gh runs: a project's main checkout on an online box, its default
// box first.
function homeOf(p: Project): { box: string; location: string } | undefined {
  const m = p.members.find((x) => x.online && x.box === p.defaultBox) ?? p.members.find((x) => x.online);
  return m ? { box: m.box, location: m.location.name } : undefined;
}

// latestFailures keeps each branch and workflow's latest run, and of those
// the ones that failed, on the given branches.
export function latestFailures(runs: Run[], branches: Set<string>): Run[] {
  const latest = new Map<string, Run>();
  for (const r of runs) {
    if (!branches.has(r.headBranch) || r.status !== "completed") continue;
    const k = `${r.headBranch}\u0000${r.workflowName}`;
    const had = latest.get(k);
    if (!had || had.createdAt < r.createdAt) latest.set(k, r);
  }
  return [...latest.values()].filter((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------- Pull requests ----------

const usePRData = (berth: BerthPluginContext) => {
  const projects = useProjects();
  const at = projects.filter((p) => p.slug).map(homeOf).find(Boolean) ?? projects.map(homeOf).find(Boolean);
  return useWidgetData<HomePRs>(
    `prs:${at ? `${at.box}/${at.location}` : "none"}`,
    async () => {
      if (!at) throw new GhProblem("No project on an online box to run gh in", "other");
      return readGh<HomePRs>(await berth.orchestrate.exec(at.box, at.location, prsCommand(), "45s"));
    },
    { every: 3 * 60_000 },
  );
};

// The heading's count: pull requests waiting on your review.
export function usePRCount() {
  const berth = useBerth();
  const { data } = usePRData(berth);
  return data ? { n: data.reviewCount, urgent: data.reviewCount > 0 } : undefined;
}

const DECISION: Record<string, string> = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes", REVIEW_REQUIRED: "In review" };

function Checks({ state }: { state?: string | null }) {
  if (!state) return <span className="size-3.5 shrink-0" />;
  if (state === "SUCCESS")
    return (
      <Tip label="Checks pass">
        <span className="inline-flex shrink-0 text-success" role="img" aria-label="Checks pass">
          <Icon name="Check" className="size-3.5" />
        </span>
      </Tip>
    );
  if (state === "FAILURE" || state === "ERROR")
    return (
      <Tip label="Checks fail">
        <span className="inline-flex shrink-0 text-destructive" role="img" aria-label="Checks fail">
          <Icon name="CircleX" className="size-3.5" />
        </span>
      </Tip>
    );
  return (
    <Tip label="Checks running">
      <span className="inline-flex shrink-0 text-muted-foreground" role="img" aria-label="Checks running">
        <Icon name="CircleDashed" className="size-3.5" />
      </span>
    </Tip>
  );
}

export function PullRequestsWidget({ berth, size }: HomeWidgetProps) {
  const { data, error, loading } = usePRData(berth);
  const projects = useProjects();
  const tall = size === "l" || size === "t";
  if (!projects.some((p) => p.members.some((m) => m.online))) return <WidgetEmpty scene="anchor" title="No projects yet" hint="Add a project on a box with gh logged in, and your pull requests show here." />;
  const room = tall ? 8 : 3;
  if (!data && loading) return <WidgetSkeleton rows={tall ? 5 : 3} />;
  if (!data) return <GhEmpty error={error} />;
  if (!data.review.length && !data.mine.length) return <WidgetEmpty scene="anchor" title="No open pull requests" hint="Yours, and those waiting on your review, show here." />;
  // The review queue first: it waits on you.
  const review = data.review.slice(0, Math.max(1, Math.min(data.review.length, Math.ceil(room / 2))));
  const mine = data.mine.slice(0, Math.max(0, room - review.length - (data.review.length ? 1 : 0) - 1));
  const row = (p: HomePR, queue: boolean) => (
    <WidgetRow key={p.url} onClick={() => berth.openUrl(p.url)} label={`${p.title}, ${p.repository.nameWithOwner} #${p.number}`}>
      <Icon name={p.isDraft ? "GitPullRequestDraft" : "GitPullRequest"} className={cn("size-3.5 shrink-0", p.isDraft ? "text-muted-foreground" : "text-success")} />
      <span className="min-w-0 flex-1 truncate">{p.title}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground @max-[300px]:hidden">
        {p.repository.nameWithOwner.split("/")[1]}#{p.number}
      </span>
      <Checks state={p.commits?.nodes[0]?.commit.statusCheckRollup?.state} />
      <span className="w-16 shrink-0 truncate text-right text-muted-foreground text-xs @max-[360px]:hidden">{queue ? (p.author?.login ?? "") : p.isDraft ? "Draft" : (DECISION[p.reviewDecision ?? ""] ?? since(p.updatedAt))}</span>
    </WidgetRow>
  );
  return (
    <div className="flex flex-col">
      {review.length > 0 && <p className="px-2 pt-0.5 pb-0.5 text-[11px] text-warning-foreground">Waiting on your review · {data.reviewCount}</p>}
      {review.map((p) => row(p, true))}
      {mine.length > 0 && <p className={cn("px-2 pb-0.5 text-[11px] text-muted-foreground", review.length && "pt-1.5")}>Yours · {data.mineCount}</p>}
      {mine.map((p) => row(p, false))}
    </div>
  );
}

function GhEmpty({ error }: { error?: string }) {
  return <WidgetEmpty scene="storm" title="Couldn't ask GitHub" hint={error ?? "gh didn't answer"} compact />;
}

// ---------- CI failures ----------

export function CiWidget({ berth, size }: HomeWidgetProps) {
  const projects = useProjects();
  // Each project with its worktrees' branches, read where gh can run.
  const targets = useMemo(
    () =>
      projects
        .filter((p) => p.slug)
        .map((p) => ({ p, at: homeOf(p), branches: [...new Set(p.members.flatMap((m) => (m.location.worktrees ?? []).map((w) => w.branch).filter((b): b is string => !!b)))] }))
        .filter((t) => t.at && t.branches.length)
        .slice(0, 6),
    [projects],
  );
  const key = `ci:${targets.map((t) => `${t.at!.box}/${t.at!.location}:${t.branches.join("+")}`).join(",")}`;
  const { data, error, loading } = useWidgetData<{ repo: string; slug: string; box: string; location: string; run: Run }[]>(
    key,
    async () => {
      const all = await Promise.all(
        targets.map(async (t) => {
          try {
            const runs = readGh<Run[]>(await berth.orchestrate.exec(t.at!.box, t.at!.location, runsCommand(), "45s"));
            return latestFailures(runs, new Set(t.branches)).map((run) => ({ repo: t.p.name, slug: t.p.slug!, box: t.at!.box, location: t.at!.location, run }));
          } catch (err) {
            // One project's gh failing (no Actions, say) never hides the rest.
            if (err instanceof GhProblem && err.kind !== "other") throw err;
            return [];
          }
        }),
      );
      return all.flat().sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
    },
    { every: 3 * 60_000 },
  );
  const tall = size === "l" || size === "t";
  if (!targets.length) return <WidgetEmpty scene="chart" title="No GitHub projects" hint="Failed runs on your worktrees' branches show here." />;
  if (!data && loading) return <WidgetSkeleton rows={tall ? 5 : 2} />;
  if (!data) return <GhEmpty error={error} />;
  if (!data.length) return <WidgetEmpty scene="calm" title="CI is green" hint={`The latest runs on your ${targets.reduce((n, t) => n + t.branches.length, 0)} worktree branches passed.`} />;
  const shown = data.slice(0, tall ? 6 : size === "s" ? 2 : 2);
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((f) => (
        <div key={f.run.databaseId} className="group/row flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-accent/60">
          <button type="button" onClick={() => berth.openUrl(f.run.url)} className="flex min-w-0 items-center gap-2.5 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Icon name="CircleX" className="size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{f.run.workflowName}</span>
              <span className="text-muted-foreground">
                {" "}
                · {f.repo} / {f.run.headBranch}
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">{since(f.run.createdAt).replace(" ago", "")}</span>
          </button>
          <span className="flex min-w-0 items-center gap-2 pl-6 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.run.displayTitle}</span>
            <Button size="xs" variant="outline" className="h-5 rounded-[5px] px-1.5 text-[11px]" onClick={() => berth.openUrl(f.run.url)} aria-label={`Open the ${f.run.workflowName} run on ${f.run.headBranch}`}>
              Logs
            </Button>
          </span>
        </div>
      ))}
      {data.length > shown.length && <p className="px-2 text-muted-foreground text-xs">+{data.length - shown.length} more failing</p>}
    </div>
  );
}
