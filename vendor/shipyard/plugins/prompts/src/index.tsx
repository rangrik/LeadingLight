import { definePlugin, useProjects, type BerthPluginContext, type SavedPrompt, type ScreenProps } from "@berth/plugin";
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
  FilterChip,
  Icon,
  Input,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  ViewHeader,
} from "@berth/plugin/ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { EditSheet } from "./edit-sheet";

// The prompt library: saved prompts for agents, kept on this laptop. The
// app owns sending (its picker, ⌘K, panes' menus, broadcast); this is where
// you write, find and tidy them.

export const SCREEN = "prompt-library";

export default definePlugin((berth) => {
  berth.addScreen({ id: SCREEN, title: "Prompts", Component: Library });
  berth.addSidebarItem({ id: "prompts", title: "Prompts", icon: "BookMarked", screen: SCREEN });
  berth.addCommand({ id: "open", title: "Open the prompt library", group: "Prompts", run: () => berth.openScreen(SCREEN) });
  void berth.prompts.load();
});

export function useLibrary(berth: BerthPluginContext) {
  return useSyncExternalStore(berth.prompts.subscribe, berth.prompts.list);
}

// Tokens in a body, marked so variables stand out in a card.
export function Marked({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[a-zA-Z_][\w.-]*\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="rounded-[3px] bg-info/10 px-0.5 font-mono text-[0.95em] text-info-foreground">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Library({ berth }: ScreenProps) {
  const prompts = useLibrary(berth);
  const projects = useProjects();
  const [query, setQuery] = useState("");
  // Tags to narrow to; a prompt shows when it has every one.
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditingState] = useState<SavedPrompt | "new">();
  const [deleting, setDeleting] = useState<SavedPrompt>();
  // The sheet is mounted only while open, so it can't hand the keyboard back
  // itself: what opened it gets it again when it closes (New prompt, a card).
  const opener = useRef<HTMLElement | null>(null);
  const setEditing = (p: SavedPrompt | "new" | undefined) => {
    if (p && !editing) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingState(p);
    if (!p)
      window.setTimeout(() => {
        const el = opener.current;
        if (el?.isConnected && (document.activeElement === document.body || !document.activeElement)) el.focus();
      }, 0);
  };
  const starters = prompts === berth.prompts.starters;

  useEffect(() => {
    void berth.prompts.load();
  }, [berth]);

  const tags = useMemo(() => [...new Set(prompts.flatMap((p) => p.tags))].sort(), [prompts]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = prompts.filter((p) => picked.every((t) => p.tags.includes(t)) && words.every((w) => `${p.title} ${p.tags.join(" ")} ${p.body}`.toLowerCase().includes(w)));
  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name ?? id;
  const missingStarters = berth.prompts.starters.filter((s) => !prompts.some((p) => p.id === s.id));

  const save = (next: SavedPrompt[]) =>
    berth.prompts.save(next).catch((err: unknown) => berth.notify("Couldn't save the prompt library", err instanceof Error ? err.message : String(err)));

  const duplicate = (p: SavedPrompt) => {
    const copy = { ...p, id: berth.prompts.newId(), title: `${p.title} (copy)`, uses: 0, last_used: undefined, updated: new Date().toISOString() };
    const i = prompts.indexOf(p);
    void save([...prompts.slice(0, i + 1), copy, ...prompts.slice(i + 1)]);
  };

  return (
    <div>
      <ViewHeader
        title="Prompts"
        description={<>Prompts you send agents again and again. Send one from <b className="font-medium text-foreground">⌘K</b> or a pane's menu, or to several agents at once.</>}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => berth.prompts.openBroadcast()}>
              <Icon name="Users" />
              Send to several…
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Icon name="Plus" />
              New prompt
            </Button>
          </>
        }
      />
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input className="w-64" size="sm" placeholder="Search prompts…" aria-label="Search prompts" value={query} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Tags">
            {tags.map((t) => (
              <FilterChip key={t} pressed={picked.includes(t)} onPressedChange={(on: boolean) => setPicked((ps) => (on ? [...ps, t] : ps.filter((x) => x !== t)))}>
                {t}
              </FilterChip>
            ))}
          </div>
          {missingStarters.length > 0 && !starters && (
            <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => void save([...prompts, ...missingStarters])}>
              Add the starter prompts back ({missingStarters.length})
            </Button>
          )}
        </div>

        {starters && (
          <p className="mb-4 rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-xs">
            These are starters to get going. Edit them, delete them, or add your own; the library is kept on this laptop, for every window.
          </p>
        )}

        {shown.length === 0 ? (
          <Empty className="rounded-xl border py-16">
            <EmptyHeader>
              <Icon name="BookMarked" className="mx-auto mb-2 size-5 text-muted-foreground" />
              <EmptyTitle>{prompts.length ? "Nothing matches" : "No saved prompts"}</EmptyTitle>
              <EmptyDescription>{prompts.length ? "Try another search or tag." : "Save the prompts you keep typing, with {{variables}} for what changes."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {shown.map((p) => (
              <article
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => setEditing(p)}
                onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && e.target === e.currentTarget && setEditing(p)}
                className="group flex min-w-0 cursor-pointer flex-col rounded-xl border bg-card p-3.5 outline-none transition-colors hover:border-ring/40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-medium text-sm">{p.title}</h3>
                  <span onClick={(e: React.MouseEvent) => e.stopPropagation()} onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}>
                    <Menu>
                      <MenuTrigger
                        render={<button type="button" aria-label={`More for ${p.title}`} className="-my-1 -me-1 inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100" />}
                      >
                        <Icon name="Ellipsis" className="size-3.5" />
                      </MenuTrigger>
                      <MenuPopup align="end" className="min-w-44">
                        <MenuItem onClick={() => berth.prompts.openPicker({ promptId: p.id })}>
                          <Icon name="Send" />
                          Send to an agent…
                        </MenuItem>
                        <MenuItem onClick={() => berth.prompts.openBroadcast({ promptId: p.id })}>
                          <Icon name="Users" />
                          Send to several…
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem onClick={() => setEditing(p)}>
                          <Icon name="Pencil" />
                          Edit
                        </MenuItem>
                        <MenuItem onClick={() => duplicate(p)}>
                          <Icon name="Copy" />
                          Duplicate
                        </MenuItem>
                        <MenuItem variant="destructive" onClick={() => setDeleting(p)}>
                          <Icon name="Trash2" />
                          Delete…
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-4 whitespace-pre-line break-words text-muted-foreground text-xs leading-relaxed">
                  <Marked text={p.body} />
                </p>
                <footer className="mt-auto flex min-w-0 items-center gap-1 pt-3">
                  {p.project && (
                    <Badge size="sm" variant="info" className="max-w-32 truncate" title={`Only offered in ${projectName(p.project)}`}>
                      {projectName(p.project)}
                    </Badge>
                  )}
                  {p.tags.map((t) => (
                    <Badge key={t} size="sm" variant="secondary">
                      {t}
                    </Badge>
                  ))}
                  {!!p.uses && <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">{p.uses === 1 ? "used once" : `used ${p.uses}×`}</span>}
                  <span className="ml-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()} onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}>
                    <Button size="xs" variant="ghost" className="h-6 text-[11px]" onClick={() => berth.prompts.openPicker({ promptId: p.id })}>
                      Send…
                    </Button>
                  </span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditSheet
          berth={berth}
          prompt={editing === "new" ? undefined : editing}
          tags={tags}
          onClose={() => setEditing(undefined)}
          onSave={async (p) => {
            const has = prompts.some((x) => x.id === p.id);
            await berth.prompts.save(has ? prompts.map((x) => (x.id === p.id ? p : x)) : [p, ...prompts]);
            setEditing(undefined);
          }}
          onDelete={editing === "new" ? undefined : () => setDeleting(editing)}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o: boolean) => !o && setDeleting(undefined)}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>It goes from the library on this laptop. Prompts already sent are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const id = deleting?.id;
                setDeleting(undefined);
                setEditing(undefined);
                void save(prompts.filter((p) => p.id !== id));
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
