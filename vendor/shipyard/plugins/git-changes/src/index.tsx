import { definePlugin, useEvent, worktreeLocation, type WorktreePanelProps } from "@berth/plugin";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Icon,
  PickOne,
  Spinner,
  Textarea,
  Tip,
  cn,
} from "@berth/plugin/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { describeCode, diffCommand, type DiffLine, type FileChange, type GitStatus, parseDiff, parseStatus, quote, STATUS_COMMAND, splitRows } from "./git";

// Git changes: what an agent changed in a worktree, before you trust it.
// Everything is read with `git` on the box through orchestrate.exec; commit
// and push only happen behind a confirmation.

export default definePlugin((berth) => {
  berth.addWorktreePanel({ id: "changes", title: "Changes", icon: "GitCompareArrows", Component: ChangesPanel });
  berth.addCommand({ id: "open", title: "Show changes in this worktree", group: "Git", run: () => berth.openPanel("changes") });
});

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; value: T };

function ChangesPanel({ berth, box, location, worktree, path, main }: WorktreePanelProps) {
  const where = worktreeLocation({ location, worktree, main });
  const [status, setStatus] = useState<Load<GitStatus>>({ state: "loading" });
  const [selected, setSelected] = useState<string>();
  const [stamp, setStamp] = useState(0);

  const run = useCallback((command: string) => berth.orchestrate.exec(box, where, command, "60s"), [berth, box, where]);
  const refresh = useCallback(() => setStamp((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    run(STATUS_COMMAND)
      .then((r) => {
        if (!live) return;
        if (r.exit_code !== 0) setStatus({ state: "error", message: r.output.trim() || `git exited with ${r.exit_code}` });
        else setStatus({ state: "ready", value: parseStatus(r.output) });
      })
      .catch((err) => live && setStatus({ state: "error", message: String(err?.message ?? err) }));
    return () => {
      live = false;
    };
  }, [run, stamp]);

  // An agent finishing, or a terminal in this worktree, likely changed files.
  useEvent("agent.finished", (e) => e.box === box && e.data?.path === path && refresh());
  useEvent("session.stopped", (e) => e.box === box && refresh());

  const files = status.state === "ready" ? status.value.files : [];
  const current = files.find((f) => f.path === selected) ?? files[0];

  if (status.state === "loading") return <Centered><Spinner className="size-4" /> Reading changes…</Centered>;
  if (status.state === "error") {
    return (
      <Centered>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Couldn't read this worktree's changes</EmptyTitle>
            <EmptyDescription className="max-w-md whitespace-pre-wrap font-mono text-xs">{status.message}</EmptyDescription>
          </EmptyHeader>
          <Button size="sm" variant="outline" onClick={refresh}>Try again</Button>
        </Empty>
      </Centered>
    );
  }
  const { branch } = status.value;
  const added = files.reduce((n, f) => n + (f.added ?? 0), 0);
  const removed = files.reduce((n, f) => n + (f.removed ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
        <span className="truncate font-medium">{branch.branch || "detached"}</span>
        {branch.upstream ? (
          <span className="truncate text-muted-foreground text-xs">
            {branch.ahead > 0 && `↑${branch.ahead} `}
            {branch.behind > 0 && `↓${branch.behind} `}
            {branch.ahead === 0 && branch.behind === 0 ? "up to date with " : "vs "}
            {branch.upstream}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">not pushed yet</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
          {files.length > 0 && (
            <>
              <span className="text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"}</span>
              <span className="text-success">+{added}</span>
              <span className="text-destructive">−{removed}</span>
            </>
          )}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={refresh}>
          <Icon name="RefreshCw" className="size-3.5" />
        </Button>
      </header>

      {files.length === 0 ? (
        <Centered>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No changes</EmptyTitle>
              <EmptyDescription>
                The worktree matches its last commit.
                {branch.ahead > 0 && ` ${branch.ahead} commit${branch.ahead === 1 ? " is" : "s are"} not pushed yet.`}
              </EmptyDescription>
            </EmptyHeader>
            {branch.ahead > 0 || !branch.upstream ? <PushButton run={run} branch={branch.branch} onDone={refresh} berth={berth} /> : null}
          </Empty>
        </Centered>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r">
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {files.map((f) => (
                <FileRow key={f.path} file={f} active={f.path === current?.path} onSelect={() => setSelected(f.path)} />
              ))}
            </ul>
            <CommitBox run={run} count={files.length} branch={branch.branch} onDone={refresh} berth={berth} />
          </aside>
          {current && <DiffView key={`${current.path}:${stamp}`} file={current} run={run} />}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-40 flex-1 items-center justify-center gap-2 p-6 text-muted-foreground text-sm">{children}</div>;
}

const toneClass = {
  add: "text-success",
  new: "text-success",
  del: "text-destructive",
  mod: "text-warning",
  ren: "text-info",
} as const;

function FileRow({ file, active, onSelect }: { file: FileChange; active: boolean; onSelect(): void }) {
  const { label, tone } = describeCode(file.code);
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  return (
    <li>
      <Tip side="right" label={`${label}: ${file.from ? `${file.from} → ` : ""}${file.path}`}>
        <button
          type="button"
          onClick={onSelect}
          className={cn("flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-accent/60", active && "bg-accent text-foreground")}
        >
          <span className={cn("w-3 shrink-0 text-center font-mono font-semibold", toneClass[tone])}>{file.code === "??" ? "U" : file.code.trim()[0]}</span>
          <span className="min-w-0 flex-1 truncate">
            {name}
            {dir && <span className="ml-1.5 text-muted-foreground">{dir}</span>}
          </span>
          {file.binary ? (
            <span className="text-muted-foreground">bin</span>
          ) : (
            (file.added !== undefined || file.removed !== undefined) && (
              <span className="shrink-0 tabular-nums">
                <span className="text-success">+{file.added ?? 0}</span> <span className="text-destructive">−{file.removed ?? 0}</span>
              </span>
            )
          )}
        </button>
      </Tip>
    </li>
  );
}

type Run = (command: string) => Promise<{ exit_code: number; output: string; truncated?: boolean }>;

function DiffView({ file, run }: { file: FileChange; run: Run }) {
  const [diff, setDiff] = useState<Load<{ lines: DiffLine[]; truncated?: boolean }>>({ state: "loading" });
  const [mode, setMode] = useState<"unified" | "split">("unified");

  useEffect(() => {
    let live = true;
    run(diffCommand(file))
      .then((r) => live && setDiff({ state: "ready", value: { lines: parseDiff(r.output), truncated: r.truncated } }))
      .catch((err) => live && setDiff({ state: "error", message: String(err?.message ?? err) }));
    return () => {
      live = false;
    };
  }, [file, run]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className="truncate font-mono">{file.from ? `${file.from} → ${file.path}` : file.path}</span>
        <Badge variant="outline" size="sm">{describeCode(file.code).label}</Badge>
        <PickOne
          label="Diff layout"
          className="ml-auto"
          value={mode}
          onChange={(v: string) => setMode(v as "unified" | "split")}
          options={[
            { value: "unified", label: "Unified" },
            { value: "split", label: "Split" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-5">
        {diff.state === "loading" && <Centered><Spinner className="size-4" /></Centered>}
        {diff.state === "error" && <Centered>{diff.message}</Centered>}
        {diff.state === "ready" && diff.value.lines.length === 0 && <Centered>Nothing to show for this file.</Centered>}
        {diff.state === "ready" && diff.value.truncated && <p className="border-b bg-warning/8 px-3 py-1 font-sans text-warning text-xs">Only the end of this diff is shown: it is longer than 64 KB.</p>}
        {diff.state === "ready" && (mode === "unified" ? <Unified lines={diff.value.lines} /> : <Split lines={diff.value.lines} />)}
      </div>
    </section>
  );
}

const lineBg = { add: "bg-success/10", del: "bg-destructive/10", ctx: "", hunk: "bg-info/8 text-info", meta: "text-muted-foreground italic" } as const;

function Num({ n }: { n?: number }) {
  return <span className="w-11 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{n ?? ""}</span>;
}

function Unified({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="min-w-fit">
      {lines.map((l, i) => (
        <div key={i} className={cn("flex whitespace-pre", lineBg[l.kind])}>
          {l.kind === "hunk" ? (
            <span className="px-3">{l.text}</span>
          ) : (
            <>
              <Num n={l.oldNo} />
              <Num n={l.newNo} />
              <span className="w-4 shrink-0 select-none text-muted-foreground">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
              <span className="pr-4">{l.text || " "}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function Split({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => splitRows(lines), [lines]);
  return (
    <div className="min-w-fit">
      {rows.map((r, i) =>
        r.hunk ? (
          <div key={i} className={cn("whitespace-pre px-3", lineBg.hunk)}>{r.hunk}</div>
        ) : (
          <div key={i} className="grid grid-cols-2">
            <Half line={r.left} side="old" />
            <Half line={r.right} side="new" />
          </div>
        ),
      )}
    </div>
  );
}

function Half({ line, side }: { line?: DiffLine; side: "old" | "new" }) {
  if (!line) return <div className="border-r bg-muted/40" />;
  return (
    <div className={cn("flex min-w-0 whitespace-pre border-r", line.kind !== "ctx" && lineBg[line.kind])}>
      <Num n={side === "old" ? line.oldNo : line.newNo} />
      <span className="overflow-hidden pr-3">{line.text || " "}</span>
    </div>
  );
}

function CommitBox({ run, count, branch, onDone, berth }: { run: Run; count: number; branch: string; onDone(): void; berth: WorktreePanelProps["berth"] }) {
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const commit = async (push: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await run(`git add -A && git commit -q -m ${quote(message.trim())}${push ? " && git push -u origin HEAD 2>&1" : ""}`);
      if (r.exit_code !== 0) throw new Error(r.output.trim() || `git exited with ${r.exit_code}`);
      berth.notify(push ? `Committed and pushed ${branch}` : `Committed on ${branch}`, message.trim().split("\n")[0]);
      setMessage("");
      setOpen(false);
      onDone();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 space-y-2 border-t p-2">
      <Textarea
        size="sm"
        value={message}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
        placeholder="Commit message"
        rows={2}
        className="text-xs"
      />
      <Button size="sm" className="w-full" disabled={!message.trim()} onClick={() => setOpen(true)}>
        Commit {count} file{count === 1 ? "" : "s"}…
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Commit on {branch}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stages all {count} changed file{count === 1 ? "" : "s"} (including new ones) and commits them on the box. Push also sends the branch to origin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="mx-6 whitespace-pre-wrap rounded-md bg-destructive/8 p-2 font-mono text-destructive text-xs">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button variant="outline" loading={busy} onClick={() => void commit(true)}>Commit and push</Button>
            <Button loading={busy} onClick={() => void commit(false)}>Commit</Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function PushButton({ run, branch, onDone, berth }: { run: Run; branch: string; onDone(): void; berth: WorktreePanelProps["berth"] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Icon name="Upload" className="size-3.5" /> Push {branch}…
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Push {branch} to origin?</AlertDialogTitle>
            <AlertDialogDescription>Runs git push -u origin HEAD on the box.</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="mx-6 whitespace-pre-wrap rounded-md bg-destructive/8 p-2 font-mono text-destructive text-xs">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                setError(undefined);
                const r = await run("git push -u origin HEAD 2>&1").catch((err) => ({ exit_code: 1, output: String(err) }));
                setBusy(false);
                if (r.exit_code !== 0) return setError(r.output.trim());
                berth.notify(`Pushed ${branch}`);
                setOpen(false);
                onDone();
              }}
            >
              Push
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
