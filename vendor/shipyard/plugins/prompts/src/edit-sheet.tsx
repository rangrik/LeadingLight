import { useProjects, type BerthPluginContext, type SavedPrompt, type SavedPromptVariable } from "@berth/plugin";
import { AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle, Button, Input, Kbd, Menu, MenuItem, MenuPopup, MenuTrigger, Icon, Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle, Switch, Textarea, Tip, cn } from "@berth/plugin/ui";
import { useMemo, useRef, useState } from "react";

// EditSheet writes one prompt: its text with {{variables}}, labels and
// defaults for the ones you fill in, tags, where it is offered, and a live
// preview of what an agent will be sent.
export function EditSheet({
  berth,
  prompt,
  tags: known,
  onClose,
  onSave,
  onDelete,
}: {
  berth: BerthPluginContext;
  prompt?: SavedPrompt;
  tags: string[];
  onClose(): void;
  onSave(p: SavedPrompt): Promise<void>;
  onDelete?(): void;
}) {
  const projects = useProjects();
  const [title, setTitle] = useState(prompt?.title ?? "");
  const [body, setBody] = useState(prompt?.body ?? "");
  const [tags, setTags] = useState((prompt?.tags ?? []).join(", "));
  const [project, setProject] = useState(prompt?.project ?? "");
  const [meta, setMeta] = useState<Record<string, SavedPromptVariable>>(() => Object.fromEntries((prompt?.variables ?? []).map((v) => [v.name, v])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  // Esc or a click outside never throws away what was typed without asking;
  // Cancel, a deliberate press, still does.
  const [asking, setAsking] = useState(false);
  const dirty =
    title !== (prompt?.title ?? "") || body !== (prompt?.body ?? "") || tags !== (prompt?.tags ?? []).join(", ") || project !== (prompt?.project ?? "") || JSON.stringify(Object.values(meta)) !== JSON.stringify(prompt?.variables ?? []);

  const vars = useMemo(() => berth.prompts.variables({ body, variables: Object.values(meta) }), [berth, body, meta]);
  const defaults = Object.fromEntries(vars.map((v) => [v.name, v.default]));
  const segments = berth.prompts.segments(body, defaults);
  const builtin = new Set(berth.prompts.builtins.map((b) => b.name));
  const ready = !!title.trim() && !!body.trim();

  const insert = (token: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    const next = body.slice(0, at) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const setVar = (name: string, patch: Partial<SavedPromptVariable>) => setMeta((m) => ({ ...m, [name]: { ...m[name], ...patch, name } }));

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Only variables the body still uses, and only what was set for them.
      const variables = vars
        .map((v) => ({ name: v.name, label: v.label?.trim() || undefined, default: v.default || undefined, multiline: v.multiline || undefined }))
        .filter((v) => v.label || v.default || v.multiline);
      await onSave({
        ...prompt,
        id: prompt?.id ?? berth.prompts.newId(),
        title: title.trim(),
        body: body.trim(),
        tags: [...new Set(tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))],
        project: project || undefined,
        variables: variables.length ? variables : undefined,
        updated: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const scopeLabel = project ? (projects.find((p) => p.id === project)?.name ?? project) : "Everywhere";

  return (
    <Sheet open onOpenChange={(o: boolean) => !o && (dirty ? setAsking(true) : onClose())}>
      <SheetPopup className="sm:max-w-xl" showCloseButton={false}>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <SheetHeader className="gap-1 px-5 pt-5 pb-3">
            <SheetTitle className="text-base">{prompt ? "Edit prompt" : "New prompt"}</SheetTitle>
            <SheetDescription className="text-[13px]">Use {"{{variables}}"} for what changes: built-ins fill in from the agent it goes to, the rest you fill in when sending.</SheetDescription>
          </SheetHeader>

          <SheetPanel className="flex flex-col gap-4 px-5 pb-5">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-[13px]">Title</span>
              <Input autoFocus={!prompt} value={title} placeholder="e.g. Review the diff" onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="font-medium text-[13px]">Prompt</span>
              <Textarea ref={area} rows={7} value={body} placeholder="What the agent is told. e.g. Review {{branch}} against {{base}} and list bugs first." onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)} />
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-muted-foreground text-xs">Insert</span>
                {berth.prompts.builtins.map((b) => (
                  <Tip key={b.name} label={b.label}>
                    <button type="button" onClick={() => insert(`{{${b.name}}}`)} className="h-6 rounded-md bg-muted px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                      {b.name}
                    </button>
                  </Tip>
                ))}
                <Tip label="A variable you fill in when sending">
                  <button type="button" onClick={() => insert("{{focus}}")} className="h-6 rounded-md border border-dashed px-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                    + your own
                  </button>
                </Tip>
              </div>
            </div>

            {vars.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-[13px]">Your variables</span>
                <div className="overflow-hidden rounded-lg border">
                  {vars.map((v) => (
                    <div key={v.name} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2 border-b px-3 py-2 last:border-b-0">
                      <span className="truncate font-mono text-[12px]">{`{{${v.name}}}`}</span>
                      <Input size="sm" aria-label={`Label for ${v.name}`} placeholder="Label" value={meta[v.name]?.label ?? ""} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVar(v.name, { label: e.target.value })} />
                      <Input size="sm" aria-label={`Default for ${v.name}`} placeholder="Default" value={meta[v.name]?.default ?? ""} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVar(v.name, { default: e.target.value })} />
                      <Tip label="Ask for it in a text box">
                        <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground text-xs">
                          <Switch checked={!!meta[v.name]?.multiline} onCheckedChange={(on: boolean) => setVar(v.name, { multiline: on })} />
                          Long
                        </label>
                      </Tip>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="font-medium text-[13px]">Tags</span>
                <Input value={tags} placeholder={known.length ? known.slice(0, 3).join(", ") : "review, tests"} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTags(e.target.value)} />
              </label>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="font-medium text-[13px]">Offered</span>
                <Menu>
                  <MenuTrigger render={<Button type="button" variant="outline" className="justify-between font-normal" />}>
                    <span className="truncate">{scopeLabel}</span>
                    <Icon name="ChevronsUpDown" className="opacity-60" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="max-h-72 min-w-56">
                    <MenuItem onClick={() => setProject("")}>
                      <Icon name="Globe" />
                      Everywhere
                    </MenuItem>
                    {projects.map((p) => (
                      <MenuItem key={p.id} onClick={() => setProject(p.id)}>
                        <Icon name="FolderGit2" />
                        <span className="truncate">{p.name}</span>
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="flex items-baseline gap-2 font-medium text-[13px]">
                Preview
                <span className="font-normal text-muted-foreground text-xs">
                  <span className="rounded-[3px] bg-info/10 px-1 font-mono text-[11px] text-info-foreground">built-ins</span> fill in per agent
                </span>
              </span>
              <div className="min-h-16 whitespace-pre-wrap break-words rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed">
                {body.trim() ? (
                  segments.map((s, i) =>
                    !s.variable ? (
                      <span key={i}>{s.text}</span>
                    ) : (
                      <Tip key={i} label={builtin.has(s.variable) ? "Filled in from the agent it goes to" : s.missing ? "Asked for when sending" : "Its default"}>
                        <span
                          className={cn(
                            "rounded-[3px] px-0.5",
                            builtin.has(s.variable) ? "bg-info/10 font-mono text-[12px] text-info-foreground" : s.missing ? "bg-warning/12 font-mono text-[12px] text-warning-foreground" : "bg-primary/10",
                          )}
                        >
                          {builtin.has(s.variable) || s.missing ? s.variable : s.text}
                        </span>
                      </Tip>
                    ),
                  )
                ) : (
                  <span className="text-muted-foreground">What you write shows here, as an agent will get it.</span>
                )}
              </div>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </SheetPanel>

          <SheetFooter className="flex-row items-center px-5 py-3">
            {onDelete && (
              <Button type="button" variant="ghost" className="mr-auto text-destructive-foreground" onClick={onDelete}>
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" className={onDelete ? undefined : "ml-auto"} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!ready}>
              Save
              <Kbd className="-me-1 bg-primary-foreground/16 text-primary-foreground/80">⌘↵</Kbd>
            </Button>
          </SheetFooter>
        </form>
      </SheetPopup>
      <AlertDialog open={asking} onOpenChange={(o: boolean) => !o && setAsking(false)}>
        <AlertDialogPopup initialFocus={keep}>
          <AlertDialogHeader>
            <AlertDialogTitle>{prompt ? "Discard your changes?" : "Discard this prompt?"}</AlertDialogTitle>
            <AlertDialogDescription>{prompt ? `What you changed in “${prompt.title}” is lost.` : "What you wrote is lost. It isn't saved anywhere yet."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose ref={keep} render={<Button variant="ghost" />}>
              Keep editing
            </AlertDialogClose>
            <Button variant="destructive" onClick={onClose}>
              Discard
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Sheet>
  );
}
