import { Folder, GitBranch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Fieldset, FieldsetLegend } from "@leadinglight/ui/components/fieldset";
import { Form } from "@leadinglight/ui/components/form";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { EFFORTS, isClaude, labelOf, MODELS, useAiPrefs } from "~/lib/ai-prefs";
import { NotStarted, startWork, worktreeFor } from "~/lib/assign";
import { codex, effortFor, effortsFor, loadCodex } from "~/lib/codex";
import { pageLabel } from "~/lib/labels";
import { folders } from "~/lib/project-runtime/folders";
import { scope } from "~/lib/scope";
import { pageOf } from "~/lib/space";
import { createStore } from "~/lib/state";
import { telling, worktreeName } from "~/lib/worktree-name";
import { loadWorktrees, worktrees } from "~/lib/worktrees";

// New work (features/work-view.feature): one box for what to do, where, and who. With an agent it
// makes a task and assigns it (lib/assign.ts); with none, only a worktree. COSS's "Dialog with form".

const NONE = "none";

// The project the box is open for.
export const newWork = createStore<string | null>(null);

// By its key: for the project on the rail, when it has a folder.
export function openNewWork() {
  const id = scope.get().id;
  const folder = folders.get().get(id);
  if (!folder || folder.missing) return void toastManager.add({ title: "New work needs a project with a linked folder. Choose one on the rail.", timeout: 4000 });
  newWork.set(id);
}

function Box({ project, onClose }: { project: string; onClose: () => void }) {
  const prefs = useAiPrefs();
  const cx = codex.use();
  const folder = folders.use().get(project);
  const location = folder?.folder.location ?? "";
  const repo = !!folder?.repo;
  const rows = worktrees.use()[location]?.rows;
  const [text, setText] = useState("");
  const [where, setWhere] = useState<"worktree" | "here">("worktree");
  const [model, setModel] = useState(prefs.model);
  const [effort, setEffort] = useState(prefs.effort);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadCodex();
    if (repo) void loadWorktrees(location);
  }, [location, repo]);
  const title = text.trim().split("\n")[0].trim();
  const agent = model !== NONE;
  const own = repo && where === "worktree";
  // As lib/assign.ts will name it, from the names taken now.
  const name = useMemo(() => (own && telling(title).length ? worktreeName(title, new Set(rows?.map((r) => r.name))) : ""), [own, title, rows]);
  const gpt = cx.state === "ready" ? cx.models : [];
  const noCodex = agent && !isClaude(model) && cx.state !== "ready";
  const nothing = !agent && !own;
  const efforts = agent ? effortsFor(model) : [];
  const can = !!title && !nothing && !noCodex && !busy;
  const models = Object.fromEntries([...MODELS.map((m) => [m.value, m.label]), ...gpt.map((m) => [m.id, m.name]), [NONE, "No agent"]]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (agent) {
        await startWork(project, text, { model, effort: effortFor(model, effort), access: prefs.access, worktree: own });
        toastManager.add({ type: "success", title: `Started “${title}”`, timeout: 2500 });
      } else {
        const made = (await worktreeFor(location, title)).split("/")[1];
        void loadWorktrees(location);
        toastManager.add({ type: "success", title: `Made the worktree ${made}`, timeout: 2500 });
      }
      onClose();
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // The names taken may have changed under it: the hint reads them again.
      if (!(e instanceof NotStarted)) return (void loadWorktrees(location), setError(why));
      toastManager.add({ type: "error", title: `“${title}” was made, but its agent didn't start.`, description: <>{why}<span className="block">Open the task to try again.</span></> });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>New work</DialogTitle>
        <DialogDescription>
          For {pageLabel(pageOf(project)?.title ?? "")}, in the folder {folder?.folder.path.split("/").at(-1)}.
        </DialogDescription>
      </DialogHeader>
      <Form className="contents" onSubmit={(e) => (e.preventDefault(), can && void submit())}>
        <DialogPanel className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Field invalid={!!error}>
            <FieldLabel>What to do</FieldLabel>
            <Textarea
              autoFocus
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && can && void submit()}
              placeholder="The first line names it"
              rows={4}
              value={text}
            />
            {error && <FieldError match>{error}</FieldError>}
          </Field>
          {repo && (
            <Field>
              <Fieldset className="flex w-full flex-col gap-2">
                <FieldsetLegend className="font-medium text-base/4.5 sm:text-sm/4">Where</FieldsetLegend>
                <SegmentedControl aria-label="Where" className="w-full" render={<RadioGroupPrimitive onValueChange={(v) => setWhere(v as "worktree" | "here")} value={where} />}>
                  <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root value="worktree" />}>
                    <GitBranch />
                    New worktree
                  </SegmentedControlItem>
                  <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root value="here" />}>
                    <Folder />
                    This checkout
                  </SegmentedControlItem>
                </SegmentedControl>
              </Fieldset>
              <FieldDescription>
                {nothing ? "Choose an agent or a new worktree." : !own ? "In the folder itself, on the branch it is on." : name ? `On a new branch, ll/${name}` : "Named from what you write."}
              </FieldDescription>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel>Agent</FieldLabel>
              {/* An effort the new model lacks becomes one it has, as in the chat's composer. */}
              <Select items={models} onValueChange={(v) => (setModel(v as string), v !== NONE && setEffort(effortFor(v as string, effort)))} value={model}>
                <SelectTrigger aria-label="Agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectGroup>
                    <SelectGroupLabel>Claude</SelectGroupLabel>
                    {MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {gpt.length > 0 && (
                    <SelectGroup>
                      <SelectGroupLabel>Codex</SelectGroupLabel>
                      {gpt.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {/* With no worktree to make, no agent would make nothing. */}
                  {repo && <SelectItem value={NONE}>No agent</SelectItem>}
                </SelectPopup>
              </Select>
            </Field>
            {efforts.length > 0 && (
              <Field>
                <FieldLabel>Effort</FieldLabel>
                {/* Keyed by the model: a select whose chosen item leaves its list goes back to its first value. */}
                <Select items={Object.fromEntries(efforts.map((e) => [e, labelOf(EFFORTS, e)]))} key={model} onValueChange={(v) => setEffort(v as string)} value={effortFor(model, effort)}>
                  <SelectTrigger aria-label="Effort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {efforts.map((e) => (
                      <SelectItem key={e} value={e}>
                        {labelOf(EFFORTS, e)}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            )}
            {noCodex && cx.state !== "checking" && <p className="col-span-2 text-destructive-foreground text-xs">Codex isn't on this Mac or isn't signed in.</p>}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          {/* A form with an error showing won't submit, so the press starts it itself, as Assign's does. */}
          <Button disabled={!can} onClick={(e) => (e.preventDefault(), void submit())} type="submit">
            {agent ? (busy ? "Starting…" : "Start") : busy ? "Making…" : "Make worktree"}
          </Button>
        </DialogFooter>
      </Form>
    </>
  );
}

export function NewWork() {
  const project = newWork.use();
  // Kept while it closes, so the box doesn't empty as it fades.
  const last = useRef(project);
  if (project) last.current = project;
  return (
    <Dialog onOpenChange={(open) => !open && newWork.set(null)} open={!!project}>
      <DialogPopup className="sm:max-w-md">{last.current && <Box onClose={() => newWork.set(null)} project={last.current} />}</DialogPopup>
    </Dialog>
  );
}
