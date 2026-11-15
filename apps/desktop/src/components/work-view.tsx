import { GitBranch, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle } from "@leadinglight/ui/components/alert-dialog";
import { Button } from "@leadinglight/ui/components/button";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { Table, TableBody, TableCaption, TableCell, TableRow } from "@leadinglight/ui/components/table";
import { cn } from "@leadinglight/ui/lib/utils";
import { newWork } from "~/components/new-work";
import { visit } from "~/components/property-value";
import { cell, line, tasksAtWork, WorkTable } from "~/components/work-table";
import { useKeysFor } from "~/lib/keymap";
import type { ObjectSummary } from "~/lib/objects";
import { folders } from "~/lib/project-runtime/folders";
import { pageOf, space } from "~/lib/space";
import { runOf, taskOfAgent } from "~/lib/work";
import { STATE_LABEL } from "~/lib/work-watch";
import { atWork, followWorktrees, loadWorktrees, removeWorktree, type Worktree, worktrees } from "~/lib/worktrees";

// A project's Work view (features/work-view.feature): its tasks in flight, then every worktree of
// its folder as the runtime lists them. Rows are the Work table's, so both read as one list.

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const heading = "mb-1 font-medium text-muted-foreground";

// The task a worktree was made for: its lead agent's, by where that agent runs.
const taskIn = (ref: string, pages: ObjectSummary[]) =>
  pageOf(taskOfAgent(pages.filter((p) => runOf(p)?.location === ref && !(p.properties["agent-parent"] as string[] | undefined)?.length).at(0)) ?? "");

function WorktreeRow({ row, task, onRemove }: { row: Worktree; task?: ObjectSummary; onRemove: () => void }) {
  const branch = row.branch ?? "detached";
  const who = row.who ? `${row.who} · ${STATE_LABEL[row.state ?? "idle"]}` : "No agent";
  const files = row.changed + row.untracked;
  const changed = [files ? `${count(files, "file")} changed` : "No changes", row.ahead ? count(row.ahead, "commit") : ""].filter(Boolean).join(" · ");
  const actions = (
    <>
      {task && (
        <Button onClick={(e) => visit(task.id, e)} size="xs" variant="outline">
          Open task
        </Button>
      )}
      {row.removable && (
        <Button onClick={onRemove} size="xs" variant="outline">
          Remove
        </Button>
      )}
    </>
  );
  const wide = "hidden @min-[900px]/work:table-cell";
  return (
    <TableRow data-worktree={row.name}>
      <TableCell className={cn(cell, "w-full max-w-0 px-0 @min-[900px]/work:pe-2.5")}>
        <div className={cn(line, "gap-2")}>
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-medium">{row.name}</span>
          {/* The branch takes only the room the name leaves, so a long one never squeezes it. */}
          <span className="hidden min-w-0 flex-1 basis-0 truncate text-muted-foreground @min-[900px]/work:block">{branch}</span>
          <span className="ms-auto flex shrink-0 gap-1 @min-[900px]/work:hidden">{actions}</span>
        </div>
        <div className="ms-6 whitespace-normal text-muted-foreground @min-[900px]/work:hidden">{[branch, who, changed].join(" · ")}</div>
      </TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground")} data-state={row.state}>
        <span className={line}>{who}</span>
      </TableCell>
      <TableCell className={cn(cell, wide, "text-muted-foreground tabular-nums")}>
        <span className={line}>{changed}</span>
      </TableCell>
      <TableCell className={cn(cell, wide, "pe-0 text-right")}>
        <span className={cn(line, "justify-end gap-1")}>{actions}</span>
      </TableCell>
    </TableRow>
  );
}

// Asks first. An agent at work there refuses it; uncommitted files ask a second time.
function RemoveDialog({ location, path, onClose }: { location: string; path: string | null; onClose: () => void }) {
  const rows = worktrees.use()[location]?.rows ?? [];
  // Kept while it closes, so the words don't empty as it fades.
  const last = useRef<Worktree | undefined>(undefined);
  const row = rows.find((r) => r.path === path) ?? last.current;
  last.current = row;
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => (setDirty(false), setError(null)), [path]);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      // Read now: an agent may have started there since the list was.
      await loadWorktrees(location);
      const now = worktrees.get()[location]?.rows.find((r) => r.path === path);
      if (!now) return onClose();
      if (atWork(now)) return;
      if ((await removeWorktree(location, now.name, dirty)) === "uncommitted") setDirty(true);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const inUse = atWork(row);
  return (
    <AlertDialog onOpenChange={(open) => !open && onClose()} open={path !== null}>
      <AlertDialogPopup className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{inUse ? `${row?.name} is in use` : `Remove ${row?.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {inUse
              ? `${row?.who} ${row?.who.endsWith("s") ? "are" : "is"} at work in it. Stop it, or wait until it is done.`
              : dirty
                ? `${row?.name} has files that aren't committed. Removing it deletes them.`
                : `Its folder is deleted.${row?.branch ? ` The branch ${row.branch} and its commits stay.` : ""}${row?.who ? ` ${row.who}'s session there ends.` : ""}`}
            {error && <span className="mt-2 block text-destructive-foreground">{error}</span>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>{inUse ? "OK" : "Cancel"}</AlertDialogClose>
          {!inUse && (
            <Button disabled={busy} onClick={() => void remove()} variant="destructive">
              {dirty ? "Remove anyway" : "Remove"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function WorkView({ pageId }: { pageId: string }) {
  const { pages } = space.use();
  const keys = useKeysFor()("new-work");
  const folder = folders.use().get(pageId);
  const location = folder?.folder.location;
  const plain = folder?.repo === false;
  const list = worktrees.use()[location ?? ""];
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => (location && !plain ? followWorktrees(location) : undefined), [location, plain]);
  const tasks = tasksAtWork(pageId, pages);
  const going = tasks.filter((t) => t.properties.done !== true).length;
  return (
    // Laid out as a type's list is: the pane's width, the same gutters and title.
    <div className="w-full max-w-[1200px] ps-6 pe-6 pt-10 pb-48 @sm:ps-16 @xl:pe-16">
      <h1 className="font-bold font-heading text-[36px] leading-[1.2] tracking-tight">Work</h1>
      {!location ? (
        <p className="mt-3 text-muted-foreground text-sm">Link a folder to this project to start work in it.</p>
      ) : (
        <div className="-ms-2 mt-3">
          <Button className="text-muted-foreground" onClick={() => newWork.set(pageId)} size="sm" variant="ghost">
            <Plus />
            New work
            {keys && <Kbd>{keys}</Kbd>}
          </Button>
        </div>
      )}
      <section aria-label="In flight" className="mt-6 text-sm">
        <h2 className={heading}>In flight{going > 0 && ` · ${going}`}</h2>
        {tasks.length > 0 ? <WorkTable label="Tasks in flight" tasks={tasks} /> : <p className="text-muted-foreground">Nothing in flight.</p>}
      </section>
      {location && (
        <section aria-label="Worktrees" className="@container/work mt-8 text-sm">
          <h2 className={heading}>Worktrees{list && list.rows.length > 0 && ` · ${list.rows.length}`}</h2>
          {plain ? (
            <p className="text-muted-foreground">This folder isn't a git checkout, so it has no worktrees.</p>
          ) : list?.error ? (
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>The worktrees can't be listed: {list.error}</span>
              <Button onClick={() => void loadWorktrees(location)} size="xs" variant="outline">
                Try again
              </Button>
            </div>
          ) : (
            <Table>
              <TableCaption className="sr-only">Worktrees</TableCaption>
              <TableBody>
                {list?.rows.map((row) => (
                  <WorktreeRow key={row.path} onRemove={() => setRemoving(row.path)} row={row} task={row.removable ? taskIn(`${location}/${row.name}`, pages) : undefined} />
                ))}
              </TableBody>
            </Table>
          )}
          <RemoveDialog location={location} onClose={() => setRemoving(null)} path={removing} />
        </section>
      )}
    </div>
  );
}
