import { Ellipsis, FolderOpen, FolderPlus, FolderX } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@leadinglight/ui/components/field";
import { Form } from "@leadinglight/ui/components/form";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@leadinglight/ui/components/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import { toastManager } from "@leadinglight/ui/components/toast";
import { pageLabel } from "~/lib/labels";
import { openPage } from "~/lib/panes";
import { isNative } from "~/lib/platform";
import { folders, linkFolder, loadFolders, unlinkFolder } from "~/lib/project-runtime/folders";
import { projectPrefs } from "~/lib/project-runtime/prefs";
import { ask } from "~/lib/project-runtime/transport";
import { pageOf } from "~/lib/space";

// A page's linked folder (features/external-projects.feature): the Link folder button above the
// title, the dialog it opens, and the row under the title. The dialog is synara's
// CreateProjectDialog and RelocateProjectDialog in one, on COSS's "Dialog with form".

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
  useEffect(() => void isNative.then(setNative), []);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setOther(null);
    setDiffers(false);
    setBusy(false);
    void (linked ? tilde(linked.folder.path) : Promise.resolve("")).then(setPath);
  }, [open]);

  const choose = async () => {
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const picked = await pick({ directory: true, defaultPath: linked?.folder.path });
    if (typeof picked === "string") setPath(picked);
  };
  const submit = async (force: boolean) => {
    if (!path.trim()) return setError("Enter the folder's path.");
    setBusy(true);
    setError(null);
    setOther(null);
    try {
      const r = await linkFolder(pageId, path, force);
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
                  <button className="underline" onClick={() => (onOpenChange(false), openPage(other))} type="button">
                    Open {otherTitle}
                  </button>
                </FieldError>
              )}
              {differs && <FieldError match>This is a different folder from the one linked before.</FieldError>}
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={busy} type="submit">
              {differs ? "Link anyway" : linked ? "Relink" : "Link folder"}
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
          <span className="shrink-0 font-medium">{nameOf(state.folder.path)}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">{shown}</span>
        </span>
      )}
      {state.missing && (
        <Button onClick={() => setOpen(true)} size="xs" variant="outline">
          Relink…
        </Button>
      )}
      <Menu>
        <MenuTrigger render={<Button aria-label="Folder" size="icon-xs" variant="ghost" />}>
          <Ellipsis />
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
