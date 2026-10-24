import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { Select, SelectGroup, SelectGroupLabel, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { ACCESS, type Access, isClaude, MODELS, useAiPrefs } from "~/lib/ai-prefs";
import { type Agent as Profile, listAgents } from "~/lib/agents";
import { agentOfTask, assign, isTask, projectFor, taskOfDocument } from "~/lib/assign";
import { codex, effortFor, loadCodex } from "~/lib/codex";
import { pageLabel } from "~/lib/labels";
import { openBeside } from "~/lib/panes";
import { folders } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { chatView, pageOf, space } from "~/lib/space";
import { runOf } from "~/lib/work";

// Assign (features/assign.feature): a task, or a page of a project, given to an agent. The dialog is
// COSS's "Dialog with form"; how the work goes shows under the task's title (work-panel.tsx).

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
  if (!project || !page || agentOfTask(page) || taskOfDocument(pageId) || runOf(page) || page.properties.report || page.properties.role) return null;
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
