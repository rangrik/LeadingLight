import { definePlugin, sessionName, useEvent, useSessions, worktreeLocation, type WorktreePanelProps } from "@berth/plugin";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
  Icon,
  Input,
  Kbd,
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  Skeleton,
  Switch,
  Textarea,
  cn,
} from "@berth/plugin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CiWidget, PullRequestsWidget, usePRCount } from "./home";
import { type Check, checkState, type CheckState, FIELDS, type Outcome, type PR, plainText, quote, readOutcome, since } from "./gh";

// Pull request: the branch's PR as GitHub sees it, read with `gh` on the
// box, so what you see is what the box's credentials see.

export default definePlugin((berth) => {
  berth.addWorktreePanel({ id: "pr", title: "Pull request", icon: "GitPullRequest", Component: PullRequestPanel });
  berth.addCommand({ id: "open", title: "Show this worktree's pull request", group: "Git", run: () => berth.openPanel("pr") });
  berth.addHomeWidget({
    id: "prs",
    title: "Pull requests",
    description: "Pull requests waiting on your review, and your own with their checks.",
    icon: "GitPullRequest",
    category: "Code",
    sizes: ["l", "m", "t", "w"],
    source: "One GitHub search with gh on a box, every 3 minutes while on screen",
    useCount: usePRCount,
    Component: PullRequestsWidget,
  });
  berth.addHomeWidget({
    id: "ci",
    title: "CI failures",
    description: "Runs that failed on your worktrees' branches, a click from their logs.",
    icon: "CircleX",
    category: "Code",
    sizes: ["m", "s", "l", "w"],
    source: "gh run list in each GitHub project, every 3 minutes while on screen",
    Component: CiWidget,
  });
});

// useWorktreeWatch calls onChange when the worktree's branch or commit moves
// (and, with dirty, its uncommitted work): an agent mid-turn checks out,
// commits and rebases without any event saying so. It looks every 15s while
// the window is shown, and at once on coming back to it.
function useWorktreeWatch(run: (command: string, timeout?: string) => Promise<{ output: string }>, onChange: () => void, dirty = false) {
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    let live = true;
    let last: string | undefined;
    let timer = 0;
    const cmd = `git symbolic-ref -q --short HEAD; git rev-parse -q --verify HEAD${dirty ? "; git status --porcelain 2>/dev/null | cksum" : ""}`;
    const look = async () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        try {
          const { output } = await run(cmd, "15s");
          if (!live) return;
          if (last !== undefined && output !== last) changed.current();
          last = output;
        } catch {
          // The box is away; the panel says so when it loads.
        }
      }
      if (live) timer = window.setTimeout(() => void look(), 15_000);
    };
    void look();
    const back = () => void look();
    window.addEventListener("focus", back);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", back);
    };
  }, [run, dirty]);
}

function PullRequestPanel({ berth, box, location, worktree, main, path }: WorktreePanelProps) {
  const where = worktreeLocation({ location, worktree, main });
  const [outcome, setOutcome] = useState<Outcome>();
  const [stamp, setStamp] = useState(0);
  const run = useCallback((command: string, timeout = "60s") => berth.orchestrate.exec(box, where, command, timeout), [berth, box, where]);
  const refresh = useCallback(() => setStamp((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    run(`gh pr view --json ${FIELDS} 2>&1`)
      .then((r) => live && setOutcome(readOutcome(r.exit_code, r.output)))
      .catch((err) => live && setOutcome({ kind: "error", message: String(err?.message ?? err) }));
    return () => {
      live = false;
    };
  }, [run, stamp]);

  // Checks move on their own; look again while any are running.
  useEffect(() => {
    if (outcome?.kind !== "pr" || !(outcome.pr.statusCheckRollup ?? []).some((c) => checkState(c) === "pending")) return;
    const t = setTimeout(refresh, 20_000);
    return () => clearTimeout(t);
  }, [outcome, refresh]);
  useEvent("flow.finished", refresh);
  // A new branch has its own PR (or none); a push moves this one.
  useWorktreeWatch(run, refresh);

  if (!outcome) return <Loading />;
  switch (outcome.kind) {
    case "pr":
      return <PRView pr={outcome.pr} berth={berth} box={box} path={path} onRefresh={refresh} />;
    case "none":
      return <NoPR run={run} worktree={worktree} onCreated={refresh} berth={berth} />;
    case "no-gh":
      return <Notice icon="Github" title="GitHub CLI isn't installed on this box" body={<>Install <code>gh</code> on {box} and sign in with <code>gh auth login</code> to see pull requests here.</>} onRetry={refresh} />;
    case "no-auth":
      return <Notice icon="KeyRound" title="gh isn't signed in on this box" body={<>Run <code>gh auth login</code> in a terminal on {box}, then refresh.</>} onRetry={refresh} />;
    case "not-github":
      return <Notice icon="GitBranch" title="Not a GitHub repository" body="This worktree's remotes don't point at GitHub, so there are no pull requests to show." onRetry={refresh} />;
    default:
      return <Notice icon="TriangleAlert" title="Couldn't read the pull request" body={<span className="whitespace-pre-wrap font-mono text-xs">{outcome.message}</span>} onRetry={refresh} />;
  }
}

function Loading() {
  return (
    <div className="space-y-3 p-5">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function Notice({ icon, title, body, onRetry }: { icon: string; title: string; body: React.ReactNode; onRetry(): void }) {
  return (
    <div className="flex h-full min-h-60 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <Icon name={icon} className="mx-auto mb-2 size-5 text-muted-foreground" />
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription className="max-w-md">{body}</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" variant="outline" onClick={onRetry}>Refresh</Button>
      </Empty>
    </div>
  );
}

const stateBadge: Record<string, { label: string; className: string; icon: string }> = {
  OPEN: { label: "Open", className: "bg-success/12 text-success border-success/24", icon: "GitPullRequest" },
  DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground", icon: "GitPullRequestDraft" },
  MERGED: { label: "Merged", className: "bg-[oklch(0.6_0.18_300)]/12 text-[oklch(0.62_0.18_300)] border-[oklch(0.6_0.18_300)]/24", icon: "GitMerge" },
  CLOSED: { label: "Closed", className: "bg-destructive/10 text-destructive border-destructive/24", icon: "GitPullRequestClosed" },
};

const decision: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Approved", tone: "text-success" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "text-destructive" },
  REVIEW_REQUIRED: { label: "Review required", tone: "text-warning" },
};

function PRView({ pr, berth, box, path, onRefresh }: { pr: PR; berth: WorktreePanelProps["berth"]; box: string; path: string; onRefresh(): void }) {
  const st = stateBadge[pr.isDraft && pr.state === "OPEN" ? "DRAFT" : pr.state];
  const checks = pr.statusCheckRollup ?? [];
  const counts = checks.reduce<Record<CheckState, number>>((n, c) => ({ ...n, [checkState(c)]: n[checkState(c)] + 1 }), { pass: 0, fail: 0, pending: 0, skip: 0 });
  const reviews = latestReviews(pr.reviews ?? []);
  // Passed checks matter least; past a handful they fold away.
  const [showPassed, setShowPassed] = useState(false);
  const sorted = [...checks].sort((a, b) => order(checkState(a)) - order(checkState(b)));
  const fold = checks.length > 8 && !showPassed;
  const visible = fold ? sorted.filter((c) => checkState(c) === "fail" || checkState(c) === "pending") : sorted;
  const hidden = sorted.length - visible.length;
  const comments = (pr.comments ?? []).slice(-8).reverse();
  // Pick failing checks, reviews and comments, and hand them to the agent.
  const [picked, setPicked] = useState<Map<string, PrItem>>(new Map());
  const toggle = (p: PrItem) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(p.key)) n.delete(p.key);
      else n.set(p.key, p);
      return n;
    });

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 font-semibold text-base leading-snug">
            {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
          </h2>
          <Button size="sm" variant="outline" onClick={onRefresh} aria-label="Refresh">
            <Icon name="RefreshCw" className="size-3.5" />
          </Button>
          <Button size="sm" onClick={() => berth.openUrl(pr.url)}>
            Open on GitHub <Icon name="ArrowUpRight" className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
          <Badge variant="outline" className={cn("gap-1", st.className)}>
            <Icon name={st.icon} className="size-3" />
            {st.label}
          </Badge>
          <span>
            {pr.author?.login && <b className="font-medium text-foreground">{pr.author.login}</b>} {pr.state === "OPEN" ? "wants to merge" : pr.state === "MERGED" ? "merged" : "wanted to merge"} <Kbd>{pr.headRefName}</Kbd> into <Kbd>{pr.baseRefName}</Kbd>
          </span>
          <span className="tabular-nums">
            <span className="text-success">+{pr.additions}</span> <span className="text-destructive">−{pr.deletions}</span> · {pr.changedFiles} {pr.changedFiles === 1 ? "file" : "files"}
          </span>
          {pr.updatedAt && <span>updated {since(pr.updatedAt)}</span>}
        </div>
      </header>

      <Frame variant="card">
        <FrameHeader className="flex-row items-center gap-2 py-3">
          <FrameTitle>Checks</FrameTitle>
          <span className="ml-auto flex gap-3 text-xs tabular-nums">
            {counts.fail > 0 && <span className="text-destructive">{counts.fail} failing</span>}
            {counts.pending > 0 && <span className="text-warning">{counts.pending} running</span>}
            <span className="text-muted-foreground">{counts.pass} passed</span>
          </span>
        </FrameHeader>
        <FramePanel className="p-0">
          {checks.length === 0 ? (
            <p className="px-4 py-5 text-center text-muted-foreground text-sm">No checks on this pull request.</p>
          ) : (
            <ul className="divide-y">
              {visible.map((c, i) => (
                <CheckRow key={i} check={c} berth={berth} pick={checkPick(c)} picked={picked} onToggle={toggle} />
              ))}
              {hidden > 0 && (
                <li>
                  <button type="button" className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-muted-foreground text-sm hover:bg-accent/50" onClick={() => setShowPassed(true)}>
                    <Icon name="ChevronsUpDown" className="size-4" />
                    Show {hidden} passed or skipped check{hidden === 1 ? "" : "s"}
                  </button>
                </li>
              )}
              {fold === false && checks.length > 8 && (
                <li>
                  <button type="button" className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-muted-foreground text-sm hover:bg-accent/50" onClick={() => setShowPassed(false)}>
                    <Icon name="ChevronsDownUp" className="size-4" />
                    Hide passed checks
                  </button>
                </li>
              )}
            </ul>
          )}
        </FramePanel>
      </Frame>

      <Frame variant="card">
        <FrameHeader className="flex-row items-center gap-2 py-3">
          <FrameTitle>Reviews</FrameTitle>
          {pr.reviewDecision && decision[pr.reviewDecision] && <span className={cn("ml-auto text-xs", decision[pr.reviewDecision].tone)}>{decision[pr.reviewDecision].label}</span>}
        </FrameHeader>
        <FramePanel className="p-0">
          {reviews.length === 0 ? (
            <p className="px-4 py-5 text-center text-muted-foreground text-sm">Nobody has reviewed it yet.</p>
          ) : (
            <ul className="divide-y">
              {reviews.map((r, i) => (
                <li key={i} className="group/row flex items-center gap-2 px-4 py-2 text-sm">
                  {r.body?.trim() ? <PickBox pick={reviewPick(r)} picked={picked} onToggle={toggle} /> : <span className="w-4 shrink-0" />}
                  <Icon name={r.state === "APPROVED" ? "CircleCheck" : r.state === "CHANGES_REQUESTED" ? "CircleX" : "MessageSquare"} className={cn("size-4", r.state === "APPROVED" ? "text-success" : r.state === "CHANGES_REQUESTED" ? "text-destructive" : "text-muted-foreground")} />
                  <span className="font-medium">{r.author?.login ?? "someone"}</span>
                  <span className="text-muted-foreground">{reviewLabel(r.state)}</span>
                  <span className="ml-auto text-muted-foreground text-xs">{since(r.submittedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </FramePanel>
      </Frame>

      {comments.length > 0 && (
        <Frame variant="card">
          <FrameHeader className="py-3">
            <FrameTitle>Latest comments</FrameTitle>
          </FrameHeader>
          <FramePanel className="p-0">
            <ul className="divide-y">
              {comments.map((c, i) => (
                <li key={i} className={cn("group/row flex gap-2.5 px-4 py-3 text-sm", picked.has(commentPick(c).key) && "bg-accent/40")}>
                  <PickBox pick={commentPick(c)} picked={picked} onToggle={toggle} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 text-xs">
                      <span className="font-medium">{c.author?.login ?? "someone"}</span>
                      <span className="text-muted-foreground">{since(c.createdAt)}</span>
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{plainText(c.body)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      )}
      {picked.size > 0 && <SendBar pr={pr} picked={[...picked.values()]} berth={berth} box={box} path={path} onClear={() => setPicked(new Map())} />}
    </div>
  );
}

// A thing on the PR someone picked to hand to the agent: a failing check, a
// review or a comment, as a line of the prompt.
interface PrItem {
  key: string;
  label: string;
  text: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function checkPick(c: Check): PrItem {
  const url = c.detailsUrl || c.targetUrl || "";
  const run = url.match(/\/actions\/runs\/(\d+)/)?.[1];
  const name = c.name ?? c.context ?? "a check";
  return {
    key: `check:${name}:${url}`,
    label: name,
    text: `The check "${name}" ${checkState(c) === "fail" ? "failed" : "is not passing"}${url ? ` (${url})` : ""}.${run ? ` See why with \`gh run view ${run} --log-failed\`.` : ""}`,
  };
}

function reviewPick(r: NonNullable<PR["reviews"]>[number]): PrItem {
  const who = r.author?.login ?? "a reviewer";
  return { key: `review:${who}:${r.submittedAt}`, label: `${who}'s review`, text: `${who} ${reviewLabel(r.state)}: ${clip(plainText(r.body ?? ""), 800)}` };
}

function commentPick(c: NonNullable<PR["comments"]>[number]): PrItem {
  const who = c.author?.login ?? "someone";
  return { key: `comment:${who}:${c.createdAt}`, label: `${who}'s comment`, text: `${who} commented${c.url ? ` (${c.url})` : ""}: ${clip(plainText(c.body), 800)}` };
}

function PickBox({ pick, picked, onToggle, className }: { pick: PrItem; picked: Map<string, PrItem>; onToggle(p: PrItem): void; className?: string }) {
  const on = picked.has(pick.key);
  return (
    <Checkbox
      checked={on}
      onCheckedChange={() => onToggle(pick)}
      aria-label={`Pick ${pick.label}`}
      className={cn("shrink-0 transition-opacity", !on && picked.size === 0 && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100", className)}
    />
  );
}

// The prompt the picked items make: short, one line each, links rather than
// whole logs (the agent can read those itself).
function promptFor(pr: PR, picks: PrItem[]): string {
  const lines = picks.map((p, i) => `${i + 1}. ${p.text}`);
  return clip(`On pull request #${pr.number} (${pr.url}), please look at ${picks.length === 1 ? "this" : `these ${picks.length}`} and fix what needs fixing:\n\n${lines.join("\n")}`, 6000);
}

function SendBar({ pr, picked, berth, box, path, onClear }: { pr: PR; picked: PrItem[]; berth: WorktreePanelProps["berth"]; box: string; path: string; onClear(): void }) {
  const sessions = useSessions(box);
  const agents = useMemo(() => (sessions ?? []).filter((s) => s.agent && !s.exited && s.dir === path), [sessions, path]);
  const [busy, setBusy] = useState(false);
  const text = promptFor(pr, picked);
  const send = async (name: string) => {
    setBusy(true);
    try {
      await berth.orchestrate.send(box, name, text, { when: "idle" });
      berth.notify("Sent to the agent", `${picked.length} item${picked.length === 1 ? "" : "s"} from #${pr.number}; queued if it's busy.`);
      onClear();
    } catch (err) {
      berth.notify("Couldn't send it", String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      berth.notify("Copied", "Paste it to any agent.");
    } catch {
      berth.notify("Couldn't copy", "The clipboard refused it.");
    }
  };
  return (
    <div className="sticky bottom-3 z-10 flex w-fit max-w-full items-center gap-2 rounded-xl border bg-popover px-3 py-2 text-sm shadow-lg">
      <span className="tabular-nums">{picked.length} picked</span>
      {agents.length === 1 ? (
        <Button size="sm" loading={busy} onClick={() => void send(agents[0].name)}>
          <Icon name="Send" className="size-3.5" />
          Send to {sessionName(agents[0], { sessions })}
        </Button>
      ) : agents.length > 1 ? (
        <Menu>
          <MenuTrigger render={<Button size="sm" loading={busy} />}>
            <Icon name="Send" className="size-3.5" />
            Send to agent
            <Icon name="ChevronDown" className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="start">
            {agents.map((a) => (
              <MenuItem key={a.name} onClick={() => void send(a.name)}>
                {sessionName(a, { sessions })}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : (
        <span className="text-muted-foreground text-xs">No agent in this worktree</span>
      )}
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        <Icon name="Copy" className="size-3.5" />
        Copy
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear">
        <Icon name="X" className="size-3.5" />
      </Button>
    </div>
  );
}

const order = (s: CheckState) => ({ fail: 0, pending: 1, pass: 2, skip: 3 })[s];

function CheckRow({ check, berth, pick, picked, onToggle }: { check: Check; berth: WorktreePanelProps["berth"]; pick: PrItem; picked: Map<string, PrItem>; onToggle(p: PrItem): void }) {
  const s = checkState(check);
  const url = check.detailsUrl || check.targetUrl;
  const icon = { pass: "CircleCheck", fail: "CircleX", pending: "LoaderCircle", skip: "CircleMinus" }[s];
  const tone = { pass: "text-success", fail: "text-destructive", pending: "text-warning animate-spin", skip: "text-muted-foreground" }[s];
  return (
    <li className={cn("group/row flex items-center gap-2.5 px-4 py-2 text-sm", picked.has(pick.key) && "bg-accent/40")}>
      {s === "fail" ? <PickBox pick={pick} picked={picked} onToggle={onToggle} /> : <span className="w-4 shrink-0" />}
      <Icon name={icon} className={cn("size-4 shrink-0", tone)} />
      <span className="min-w-0 truncate">{check.name ?? check.context}</span>
      {check.workflowName && <span className="truncate text-muted-foreground text-xs">{check.workflowName}</span>}
      {url && (
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => berth.openUrl(url)}>
          Details
        </Button>
      )}
    </li>
  );
}

function reviewLabel(state: string) {
  return { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "commented", DISMISSED: "review dismissed" }[state] ?? state.toLowerCase();
}

// latestReviews keeps each reviewer's most recent review.
function latestReviews(reviews: NonNullable<PR["reviews"]>) {
  const by = new Map<string, (typeof reviews)[number]>();
  for (const r of reviews) by.set(r.author?.login ?? "?", r);
  return [...by.values()];
}

type Run = (command: string, timeout?: string) => Promise<{ exit_code: number; output: string }>;

function NoPR({ run, worktree, onCreated, berth }: { run: Run; worktree: string; onCreated(): void; berth: WorktreePanelProps["berth"] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = async () => {
    setError(undefined);
    // The last commit's subject is usually the best first title.
    const r = await run("git log -1 --pretty=%s").catch(() => undefined);
    setTitle(r?.exit_code === 0 ? r.output.trim() : worktree);
    setOpen(true);
  };

  const create = async () => {
    setBusy(true);
    setError(undefined);
    const r = await run(`git push -u origin HEAD 2>&1 && gh pr create --title ${quote(title.trim())} --body ${quote(body)}${draft ? " --draft" : ""} 2>&1`, "120s").catch((err) => ({ exit_code: 1, output: String(err) }));
    setBusy(false);
    if (r.exit_code !== 0) return setError(r.output.trim());
    const url = r.output.trim().split("\n").reverse().find((l) => l.startsWith("https://"));
    berth.notify(`Opened ${draft ? "a draft " : "a "}pull request`, url ?? title);
    setOpen(false);
    onCreated();
  };

  return (
    <div className="flex h-full min-h-60 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <Icon name="GitPullRequestCreate" className="mx-auto mb-2 size-5 text-muted-foreground" />
          <EmptyTitle>No pull request for this branch</EmptyTitle>
          <EmptyDescription>Open one when the work is ready for eyes. It pushes the branch first.</EmptyDescription>
        </EmptyHeader>
        <Button size="sm" onClick={() => void start()}>Create pull request…</Button>
      </Empty>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Create a pull request</AlertDialogTitle>
            <AlertDialogDescription>Pushes this branch to origin, then opens the pull request with gh on the box.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 px-6">
            <Input value={title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
            <Textarea value={body} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)} placeholder="What changed and why (optional)" rows={4} aria-label="Description" />
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft} onCheckedChange={setDraft} /> Open as a draft
            </label>
            {error && <p className="whitespace-pre-wrap rounded-md bg-destructive/8 p-2 font-mono text-destructive text-xs">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button loading={busy} disabled={!title.trim()} onClick={() => void create()}>
              Push and create
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
