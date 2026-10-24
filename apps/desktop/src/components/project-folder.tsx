import { Ellipsis, FolderGit2, FolderOpen, FolderPlus, FolderX, MessagesSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@leadinglight/ui/components/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import { RadioGroupPrimitive, RadioPrimitive } from "@leadinglight/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@leadinglight/ui/components/segmented-control";
import { toastManager } from "@leadinglight/ui/components/toast";
import { pageLabel } from "~/lib/labels";
import { openBeside, openPage } from "~/lib/panes";
import { isNative } from "~/lib/platform";
import { cloneRepo, folders, linkFolder, loadFolders, refresh, unlinkFolder } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { ask } from "~/lib/project-runtime/transport";
import { chatView, pageOf } from "~/lib/space";

// A page's linked folder (features/external-projects.feature): the Link folder button above the
// title, the dialog it opens, and the row under the title. The dialog is synara's
// CreateProjectDialog and RelocateProjectDialog in one, on COSS's "Dialog with form"; its GitHub
// side clones a repository first (slice 6).

let home: Promise<string> | null = null;
const tilde = async (path: string) => {
  home ??= ask<{ home: string }>("GET", "/v1/info").then((i) => i.home, () => "");
  const h = await home;
  return h && (path === h || path.startsWith(`${h}/`)) ? `~${path.slice(h.length)}` : path;
};
const nameOf = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

// The page's folder, while linked folders are turned on.
export function useFolder(pageId: string) {
  const all = folders.use();
  const { enabled } = projectPrefs.use();
  useEffect(() => void (enabled && loadFolders().catch(console.error)), [enabled]);
  return enabled ? all.get(pageId) : undefined;
}

export function LinkFolderDialog({ pageId, open, onOpenChange }: { pageId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const linked = folders.get().get(pageId);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [differs, setDiffers] = useState(false);
  const [native, setNative] = useState(false);
  const [source, setSource] = useState<"mac" | "github">("mac");
  const [repo, setRepo] = useState("");
  const [into, setInto] = useState("~/Developer");
  const [progress, setProgress] = useState("");
  // A folder already at the clone's place, which can be linked as it is.
  const [there, setThere] = useState<string | null>(null);
  const cloning = useRef<(() => void) | null>(null);
  useEffect(() => void isNative.then(setNative), []);
  useEffect(() => {
    if (!open) return cloning.current?.();
    setError(null);
    setOther(null);
    setDiffers(false);
    setThere(null);
    setBusy(false);
    void (linked ? tilde(linked.folder.path) : Promise.resolve("")).then(setPath);
  }, [open]);

  const choose = async () => {
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const picked = await pick({ directory: true, defaultPath: linked?.folder.path });
    if (typeof picked === "string") setPath(picked);
  };
  const submit = async (force: boolean, at = path) => {
    if (!at.trim()) return setError("Enter the folder's path.");
    setBusy(true);
    setError(null);
    setOther(null);
    try {
      const r = await linkFolder(pageId, at, force);
      if (r.ok) {
        onOpenChange(false);
        if (linked && linked.folder.folderId === r.folder.folderId && linked.folder.path !== r.folder.path) toastManager.add({ type: "success", title: "Same folder, moved", timeout: 2500 });
      } else if ("linkedTo" in r) setOther(r.linkedTo);
      else setDiffers(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const clone = () => {
    if (!repo.trim()) return setError("Enter the repository.");
    setBusy(true);
    setError(null);
    setThere(null);
    setProgress("Starting…");
    const c = cloneRepo(repo.trim(), into.trim() || "~/Developer", setProgress);
    let stopped = false;
    cloning.current = () => ((stopped = true), c.stop());
    c.done
      .then(async (loc) => {
        const r = await linkFolder(pageId, loc.path, true);
        // The page's own name for it replaces the one the clone was given.
        await ask("DELETE", `/v1/locations/${loc.name}`).catch(() => {});
        if (r.ok) onOpenChange(false);
        else if ("linkedTo" in r) setOther(r.linkedTo);
      })
      .catch((e: Error) => {
        const at = /^(.*) already exists;/.exec(e.message)?.[1];
        if (at) setThere(at);
        else if (!stopped) setError(e.message);
      })
      .finally(() => ((cloning.current = null), setBusy(false), setProgress("")));
  };
  const otherTitle = other ? pageLabel(pageOf(other)?.title ?? "") : "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{linked ? "Relink the folder" : "Link a folder"}</DialogTitle>
          <DialogDescription>The page keeps your notes; the folder keeps its files. Nothing in the folder is changed.</DialogDescription>
        </DialogHeader>
        <Form className="contents" onSubmit={(e) => (e.preventDefault(), void submit(differs))}>
          <DialogPanel className="grid gap-4">
            <SegmentedControl aria-label="Where the folder is" className="w-full" render={<RadioGroupPrimitive onValueChange={(v) => (setSource(v as "mac" | "github"), setError(null))} value={source} />}>
              <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root disabled={busy} value="mac" />}>
                <FolderOpen />
                On this Mac
              </SegmentedControlItem>
              <SegmentedControlItem className="flex-1" render={<RadioPrimitive.Root disabled={busy} value="github" />}>
                <FolderGit2 />
                From GitHub
              </SegmentedControlItem>
            </SegmentedControl>
            {source === "github" ? (
              <>
                <Field invalid={!!(error || there || other)}>
                  <FieldLabel>Repository</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderGit2 />
                    </InputGroupAddon>
                    <InputGroupInput autoCapitalize="off" autoCorrect="off" disabled={busy} onChange={(e) => (setRepo(e.currentTarget.value), setError(null), setThere(null))} placeholder="owner/name, or the repository's URL" spellCheck={false} value={repo} />
                  </InputGroup>
                  {error && <FieldError match>{error}</FieldError>}
                  {there && (
                    <FieldError match>
                      {there} is already there.{" "}
                      <Button className="h-auto p-0 text-xs sm:h-auto sm:text-xs" onClick={() => (setSource("mac"), setPath(there), void submit(false, there))} variant="link">
                        Link it
                      </Button>
                    </FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel>Clone into</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderOpen />
                    </InputGroupAddon>
                    <InputGroupInput autoCapitalize="off" autoCorrect="off" disabled={busy} onChange={(e) => setInto(e.currentTarget.value)} spellCheck={false} value={into} />
                  </InputGroup>
                  {/* git's own words while it clones, with this Mac's sign-in for GitHub. */}
                  <p className="min-h-4 truncate font-mono text-muted-foreground text-xs">{progress}</p>
                </Field>
              </>
            ) : (
            <Field invalid={!!(error || other || differs)}>
              <FieldLabel>Folder</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <FolderOpen />
                </InputGroupAddon>
                <InputGroupInput
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(e) => {
                    setPath(e.currentTarget.value);
                    setError(null);
                    setOther(null);
                    setDiffers(false);
                  }}
                  placeholder="~/path/to/folder"
                  spellCheck={false}
                  value={path}
                />
                {native && (
                  <InputGroupAddon align="inline-end">
                    <Button onClick={() => void choose()} size="xs" variant="ghost">
                      Choose…
                    </Button>
                  </InputGroupAddon>
                )}
              </InputGroup>
              {error && <FieldError match>{error}</FieldError>}
              {other && (
                <FieldError match>
                  That folder is already linked to {otherTitle}.{" "}
                  <Button className="h-auto p-0 text-xs underline sm:h-auto sm:text-xs" onClick={() => (onOpenChange(false), openPage(other))} variant="link">
                    Open {otherTitle}
                  </Button>
                </FieldError>
              )}
              {differs && <FieldError match>This is a different folder from the one linked before.</FieldError>}
            </Field>
            )}
          </DialogPanel>
          <DialogFooter>
            {/* Cancel stops a clone under way first; the runtime takes away what it made. */}
            {cloning.current ? (
              <Button onClick={() => cloning.current?.()} variant="ghost">
                Stop
              </Button>
            ) : (
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            )}
            {/* Answered on click (Enter clicks it too): Base UI's Form won't submit while the field shows an error. */}
            <Button disabled={busy} onClick={(e) => (e.preventDefault(), source === "github" ? clone() : void submit(differs))} type="submit">
              {source === "github" ? (busy ? "Cloning…" : "Clone") : differs ? "Link anyway" : linked ? "Relink" : "Link folder"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}

// Above the title, among Add icon and Add cover, while the page has no folder.
export function LinkFolderButton({ pageId, label }: { pageId: string; label: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const linked = useFolder(pageId);
  const { enabled } = projectPrefs.use();
  if (linked || !enabled) return null;
  return (
    <>
      <Button aria-label="Link folder" className="text-muted-foreground" onClick={() => setOpen(true)} size="sm" variant="ghost">
        <FolderPlus />
        {label}
      </Button>
      <LinkFolderDialog onOpenChange={setOpen} open={open} pageId={pageId} />
    </>
  );
}

// Under the title: the linked folder, or that it can't be found, with relink and unlink.
export function FolderRow({ pageId }: { pageId: string }) {
  const state = useFolder(pageId);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState("");
  useEffect(() => void (state && tilde(state.folder.path).then(setShown)), [state?.folder.path]);
  // Opening the page looks again: the folder may have moved since.
  useEffect(() => void (folders.get().has(pageId) && refresh().catch(() => {})), [pageId]);
  if (!state) return null;
  const Icon = state.missing ? FolderX : FolderOpen;
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 text-sm" data-testid="folder-row">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {state.missing ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          Folder not found: <span className="font-mono text-xs">{shown}</span>
        </span>
      ) : (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium">{nameOf(state.folder.path)}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">{shown}</span>
        </span>
      )}
      {state.missing ? (
        <Button onClick={() => setOpen(true)} size="xs" variant="outline">
          Relink…
        </Button>
      ) : (
        // The project's chat, beside the page (features/project-chat.feature).
        <Button onClick={() => openBeside(chatView(pageId))} size="xs" variant="outline">
          <MessagesSquare className="size-4" />
          Chat
        </Button>
      )}
      <Menu>
        <MenuTrigger render={<Button aria-label="Folder" size="icon-xs" variant="ghost" />}>
          <Ellipsis className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setOpen(true)}>Relink…</MenuItem>
          <MenuItem onClick={() => void unlinkFolder(pageId)}>Unlink</MenuItem>
        </MenuPopup>
      </Menu>
      <LinkFolderDialog onOpenChange={setOpen} open={open} pageId={pageId} />
    </div>
  );
}
