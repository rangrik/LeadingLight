import { Bot, MessagesSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { visit } from "~/components/property-value";
import { ACCESS, type Access, isClaude, MODELS, useAiPrefs } from "~/lib/ai-prefs";
import { type Agent as Profile, listAgents } from "~/lib/agents";
import { assign, assignmentOf, isTask, projectFor, start, taskOfDocument } from "~/lib/assign";
import { codex, effortFor, loadCodex } from "~/lib/codex";
import { pageLabel } from "~/lib/labels";
import { openBeside } from "~/lib/panes";
import { folders } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { chatView, pageOf, space } from "~/lib/space";
import { runOf } from "~/lib/work";
import { sessions, watchWork } from "~/lib/work-watch";

// Assign (features/assign.feature): a task, or a page of a project, given to an agent. The dialog is
// COSS's "Dialog with form"; the row under a task's title says who has it and how it is going.

// The page's project, while projects are on: what Assign needs.
export function useProject(pageId: string) {
  const { enabled } = projectPrefs.use();
  const all = folders.use();
  const { pages } = space.use();
  const [project, setProject] = useState<string>();
  useEffect(() => {
    let live = true;
    if (enabled) void projectFor(pageId).then((p) => live && setProject(p));
    return () => void (live = false);
  }, [enabled, all, pages, pageId]);
  return enabled ? project : undefined;
}

// The project chat on one conversation, beside the page.
export function openChat(location: string, conversation: string) {
  const project = [...folders.get().values()].find((f) => f.folder.location === location.split("/")[0])?.folder.pageId;
  if (!project) return;
  localStorage.setItem(`ll.chat.${project}`, conversation);
  window.dispatchEvent(new CustomEvent("ll:chat", { detail: { page: project, conversation } }));
  openBeside(chatView(project));
}

export function AssignDialog({ pageId, open, onOpenChange }: { pageId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const prefs = useAiPrefs();
  const cx = codex.use();
  const project = useProject(pageId);
  const [model, setModel] = useState(prefs.model);
  const [access, setAccess] = useState<Access>(prefs.access);
  const [profile, setProfile] = useState("none");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    void loadCodex();
    void listAgents().then(setProfiles);
  }, [open]);
  const page = pageOf(pageId);
  const folder = project ? folders.get().get(project)?.folder.path.split("/").at(-1) : undefined;
  const gpt = cx.state === "ready" ? cx.models : [];
  const models = Object.fromEntries([...MODELS.map((m) => [m.value, m.label]), ...gpt.map((m) => [m.id, m.name])]);
  const submit = () => {
    setBusy(true);
    setError(null);
    assign(pageId, { model, effort: effortFor(model, prefs.effort), access, note: note.trim() || undefined, profile: profiles.find((p) => p.id === profile) })
      .then((agent) => {
        onOpenChange(false);
        toastManager.add({ type: "success", title: `Assigned to ${pageLabel(pageOf(agent)?.title ?? "")}`, timeout: 2500 });
      }, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign “{pageLabel(page?.title ?? "")}”</DialogTitle>
          <DialogDescription>
            {project
              ? `An agent works on it in ${folder} with ${isTask(page) ? "this task" : "this page"} as its brief, reads the project's pages, and publishes what it did here. ${isTask(page) ? "" : "A task is made for it, linked to this page. "}You mark it done.`
              : "This page isn't part of a project with a linked folder, so no agent can work on it. Set its project, or link a folder to it, first."}
          </DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={(e) => (e.preventDefault(), project && submit())}>
          <DialogPanel className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <Field>
              <FieldLabel>Agent</FieldLabel>
              <Select items={models} onValueChange={(v) => setModel(v as string)} value={model}>
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
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Profile</FieldLabel>
              <Select items={{ none: "None", ...Object.fromEntries(profiles.map((p) => [p.id, p.name])) }} onValueChange={(v) => setProfile(v as string)} value={profile}>
                <SelectTrigger aria-label="Profile">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="none">None</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Access</FieldLabel>
              <Select items={Object.fromEntries(ACCESS.map((a) => [a.value, a.label]))} onValueChange={(v) => setAccess(v as Access)} value={access}>
                <SelectTrigger aria-label="Access">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {ACCESS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field invalid={!!error}>
              <FieldLabel>Anything to add</FieldLabel>
              <Textarea onChange={(e) => setNote(e.currentTarget.value)} placeholder="Optional" rows={2} value={note} />
              {error && <FieldError match>{error}</FieldError>}
              {!isClaude(model) && cx.state !== "ready" && <FieldError match>Codex isn't on this Mac or isn't signed in.</FieldError>}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={busy || !project} onClick={(e) => (e.preventDefault(), submit())} type="submit">
              {busy ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

// In the line under the title, on a task or a page of a project not yet given to an agent.
export function AssignButton({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const project = useProject(pageId);
  const page = pageOf(pageId);
  if (!project || !page || assignmentOf(page) || taskOfDocument(pageId) || runOf(page) || page.properties.report || page.properties.role) return null;
  return (
    <>
      <Button className="text-muted-foreground" onClick={() => setOpen(true)} size="sm" variant="ghost">
        <Bot />
        <span className="hidden @md:inline">Assign</span>
      </Button>
      <AssignDialog onOpenChange={setOpen} open={open} pageId={pageId} />
    </>
  );
}

const STATE: Record<string, string> = { running: "Working", waiting: "Waiting for you" };

// Under a task's title: the agent that has it and how it is going; on a page assigned through a
// task, that task.
export function WorkRow({ pageId }: { pageId: string }) {
  const { pages } = space.use();
  const live = sessions.use();
  const [failed, setFailed] = useState<string | null>(null);
  const page = pages.find((p) => p.id === pageId);
  const viaTask = page && !isTask(page) ? taskOfDocument(pageId) : undefined;
  const agent = pageOf(assignmentOf(page)?.agent ?? "");
  const run = runOf(agent);
  useEffect(() => {
    if (!agent || !run) return;
    watchWork();
    // Not started yet (a reload or a restart while it started): started now, once.
    if (!run.conversation) void start(agent.id).catch((e: Error) => setFailed(e.message));
  }, [agent?.id, run?.conversation]);
  if (viaTask)
    return (
      <p className="mt-2 flex items-center gap-2 text-muted-foreground text-sm" data-testid="work-row">
        <Bot className="size-4 shrink-0" />
        Assigned as the task
        <button className="font-medium text-foreground underline-offset-2 hover:underline" onClick={(e) => visit(viaTask.id, e)} type="button">
          {pageLabel(viaTask.title)}
        </button>
      </p>
    );
  if (!agent || !run) return null;
  const s = live.get(run.session);
  const state = failed ? `Didn't start: ${failed}` : !run.conversation ? "Starting…" : (STATE[s?.agent_state ?? ""] ?? "Not working now");
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 text-sm" data-testid="work-row">
      <Bot className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <button className="min-w-0 truncate font-medium underline-offset-2 hover:underline" onClick={(e) => visit(agent.id, e)} type="button">
          {pageLabel(agent.title)}
        </button>
        <span className="shrink-0 text-muted-foreground">{state}</span>
      </span>
      {failed && (
        <Button onClick={() => (setFailed(null), void start(agent.id).catch((e: Error) => setFailed(e.message)))} size="xs" variant="outline">
          Try again
        </Button>
      )}
      {run.conversation && (
        <Button onClick={() => openChat(run.location, run.conversation)} size="xs" variant="outline">
          <MessagesSquare className="size-4" />
          Chat
        </Button>
      )}
    </div>
  );
}
