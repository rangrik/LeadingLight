// COSS p-dialog-1 and p-select-1, using the app's shared project picker.
import type { PageSelection } from "@leadinglight/editor/editor";
import { Folder } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldDescription, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { Input } from "@leadinglight/ui/components/input";
import { Label } from "@leadinglight/ui/components/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Textarea } from "@leadinglight/ui/components/textarea";
import { toastManager } from "@leadinglight/ui/components/toast";
import { RowIcon } from "~/components/page-icon";
import { PagePicker } from "~/components/property-value";
import { pageLabel } from "~/lib/labels";
import { openPage } from "~/lib/panes";
import { iconFor, pageOf, space } from "~/lib/space";
import { newPage } from "~/lib/templates";

export function TurnIntoPage({ selection, onClose, recording }: { selection: PageSelection; onClose: () => void; recording?: { pageId: string; id: string } }) {
  const { types, props } = space.use();
  const choices = types.filter((type) => type.id !== "daily" && !type.made);
  const suggested = selection.text.trim().split(/\s+/).slice(0, 3).join(" ");
  const [typeId, setTypeId] = useState(() => choices.find((type) => type.id === "idea")?.id ?? choices[0]?.id ?? "page");
  const [title, setTitle] = useState(suggested);
  const [project, setProject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const projectId = useId();
  const type = choices.find((item) => item.id === typeId);
  const projectProp = type?.props.map((id) => props.find((prop) => prop.id === id)).find((prop) => prop?.kind === "relation" && prop.options.type === "project");
  const picked = project ? pageOf(project) : undefined;
  const close = () => {
    if (saving.current) return;
    onClose();
    requestAnimationFrame(selection.restoreFocus);
  };
  const create = async () => {
    if (saving.current) return;
    if (!selection.isCurrent()) { setError("The source text changed. Close this dialog and select the words again."); return; }
    if (!type) { setError("Choose an available type."); return; }
    if (projectProp && project && (!picked || picked.typeId !== "project")) { setError("That project is no longer available. Choose another project."); return; }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const page = await newPage(type.id, {
        title: title.trim() || suggested,
        content: recording ? { ...selection.content, content: [...(selection.content.content ?? []), {
          type: "paragraph", content: [{ type: "text", text: "Source recording", marks: [{ type: "link", attrs: { href: `ll:${recording.pageId}#voice-${recording.id}` } }] }],
        }] } : selection.content,
        properties: projectProp ? { [projectProp.id]: project ? [project] : [] } : {},
      });
      const linked = selection.replaceWithLink(page.id);
      onClose();
      if (linked) requestAnimationFrame(selection.restoreFocus);
      else {
        openPage(page.id);
        toastManager.add({ type: "info", title: `${type.name} created`, description: "The source changed while saving. Your new page is saved, and the source was left unchanged." });
      }
    } catch (cause) {
      setError(`Could not create the page: ${cause instanceof Error ? cause.message : String(cause)}. Your selected text is unchanged.`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogPopup finalFocus={false} showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{recording ? "Create from recording" : "Turn into"}</DialogTitle>
          <DialogDescription>{recording ? "Keep these words in a new page. Your recording and transcript stay unchanged." : "Keep the selected text in a new page, with a link in its place."}</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Type</FieldLabel>
              <Select disabled={busy} items={choices.map((item) => ({ value: item.id, label: item.name }))} value={typeId} onValueChange={(value) => { if (value) setTypeId(value); }}>
                <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  {choices.map((item) => <SelectItem key={item.id} value={item.id}><span className="flex items-center gap-2"><RowIcon icon={item.icon} />{item.name}</span></SelectItem>)}
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Title</FieldLabel>
              <Input autoFocus aria-label="Title" disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={suggested} />
              <FieldDescription>Leave blank to use the first three words.</FieldDescription>
            </Field>
            {projectProp && <div className="grid gap-2">
              <Label htmlFor={projectId}>{projectProp.name}</Label>
              <PagePicker label="Project" typeId="project" exclude={[]} onPick={setProject} onClear={project ? () => setProject(null) : undefined}
                trigger={<Button id={projectId} aria-label="Project" disabled={busy} variant="outline" className="min-w-0 justify-start font-normal">
                  {picked ? <RowIcon icon={iconFor(picked)} /> : <Folder className="size-4" />}
                  <span className="min-w-0 flex-1 truncate text-left">{picked ? pageLabel(picked.title) : "No project"}</span>
                </Button>} />
            </div>}
            <Field>
              <FieldLabel>Body</FieldLabel>
              <Textarea aria-label="Body" readOnly value={selection.text} className="max-h-48 min-h-24" />
            </Field>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </DialogPanel>
          <DialogFooter>
            <DialogClose disabled={busy} render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={busy || !type} type="submit">{busy ? "Creating…" : `Create ${type?.name.toLowerCase() ?? "page"}`}</Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
