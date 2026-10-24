import { objects, type ProjectFolder } from "~/lib/objects";
import { onRuntimeEvent } from "~/lib/project-runtime/live";
import { ask, stream } from "~/lib/project-runtime/transport";
import { createStore } from "~/lib/state";

// Pages linked to folders (features/external-projects.feature). LeadingLight keeps which page
// has which folder; the runtime knows each folder as a location named after the page, and says
// which folder it is (its identity, not its path) and whether it is there.

type Location = { name: string; path: string; folder_id?: string; missing?: boolean; repo?: boolean };
// repo: a Git checkout, whose chats can work on a branch of their own.
export type FolderState = { folder: ProjectFolder; missing: boolean; repo?: boolean };

export const folders = createStore<Map<string, FolderState>>(new Map());

// A location name of the page's own: berthd takes letters, digits, dots and dashes.
const locationOf = (pageId: string) => `p-${pageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;

let loaded: Promise<void> | null = null;
let listening = false;
export function loadFolders(): Promise<void> {
  loaded ??= (async () => {
    const list = await objects.folders();
    folders.set(new Map(list.map((f) => [f.pageId, { folder: f, missing: false }])));
    if (list.length) await refresh();
  })();
  return loaded;
}

// The runtime is followed only once a page has a folder: no folder, no runtime.
function listen() {
  if (listening) return;
  listening = true;
  onRuntimeEvent((e) => e.type.startsWith("location.") && folders.get().size > 0 && void refresh().catch(() => {}));
}

// Whether each linked folder is there now, as the runtime sees it.
export async function refresh(): Promise<void> {
  listen();
  const all = await ask<Location[]>("GET", "/v1/locations");
  const byName = new Map(all.map((l) => [l.name, l]));
  const next = new Map(folders.get());
  for (const [id, s] of next) {
    const loc = byName.get(s.folder.location);
    // A link from before this runtime (a new Mac, a cleared runtime) is told to it again.
    if (!loc) {
      const again = await ask<Location>("POST", "/v1/locations", { name: s.folder.location, path: s.folder.path }).catch(() => null);
      next.set(id, { ...s, missing: !again || !!again.missing, repo: !!again?.repo });
      continue;
    }
    next.set(id, { ...s, missing: !!loc.missing, repo: !!loc.repo });
  }
  folders.set(next);
}

// Which folder a path is: the runtime resolves it under a throwaway name, then forgets it.
async function identify(path: string): Promise<Location> {
  const probe = `check-${crypto.randomUUID().slice(0, 8)}`;
  let loc: Location;
  try {
    loc = await ask<Location>("POST", "/v1/locations", { name: probe, path: path.trim() });
  } catch {
    throw new Error(`No folder at ${path.trim()}`);
  }
  await ask("DELETE", `/v1/locations/${probe}`).catch(() => {});
  if (!loc.folder_id) throw new Error(`No folder at ${path.trim()}`);
  return loc;
}

export type LinkResult = { ok: true; folder: ProjectFolder } | { ok: false; linkedTo: string } | { ok: false; differs: true; path: string };

// Links pageId to the folder at path. A folder another page has is refused; relinking to a
// folder other than the one before asks first (force).
export async function linkFolder(pageId: string, path: string, force = false): Promise<LinkResult> {
  const found = await identify(path);
  const mine = folders.get().get(pageId)?.folder;
  for (const [id, s] of folders.get()) if (id !== pageId && s.folder.folderId === found.folder_id) return { ok: false, linkedTo: id };
  if (mine && mine.folderId !== found.folder_id && !force) return { ok: false, differs: true, path: found.path };
  const location = locationOf(pageId);
  const loc = await ask<Location>("POST", "/v1/locations", { name: location, path: found.path });
  const now = Date.now();
  const folder: ProjectFolder = { pageId, path: loc.path, folderId: loc.folder_id ?? found.folder_id ?? "", location, createdAt: mine?.createdAt ?? now, updatedAt: now };
  await objects.putFolder(folder);
  folders.set(new Map(folders.get()).set(pageId, { folder, missing: false, repo: !!loc.repo }));
  return { ok: true, folder };
}

// owner/name is a GitHub repository; anything else is git's own URL.
const repoUrl = (s: string) => (/^[\w.-]+\/[\w.-]+$/.test(s) ? `https://github.com/${s}.git` : s);

// Clones a repository with this Mac's own Git sign-in into parent, git's progress line by line.
// The runtime removes a clone that fails or is stopped. Resolves to where it landed.
export function cloneRepo(repo: string, parent: string, progress: (line: string) => void) {
  let stop = () => {};
  const done = new Promise<{ name: string; path: string }>((ok, fail) => {
    let last: { location?: Location; error?: string } = {};
    stop = stream("POST", "/v1/locations/clone", { url: repoUrl(repo), parent }, 600, (line) => {
      try {
        const m = JSON.parse(line) as { line?: string; done?: boolean; location?: Location; error?: string };
        if (m.line) progress(m.line);
        if (m.done || m.error) last = m;
      } catch {
        // Not one of the runtime's lines.
      }
    }, () => (last.location ? ok(last.location) : fail(new Error(last.error ?? "The clone stopped."))));
  });
  return { stop: () => stop(), done };
}

// The page forgets its folder; the folder and its files are left as they are.
export async function unlinkFolder(pageId: string): Promise<void> {
  const s = folders.get().get(pageId);
  if (s) await ask("DELETE", `/v1/locations/${s.folder.location}`).catch(() => {});
  await objects.deleteFolder(pageId);
  const next = new Map(folders.get());
  next.delete(pageId);
  folders.set(next);
}
