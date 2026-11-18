import { bar, refocus } from "./browser-space";
import { DAILY, dayPage, today } from "./daily";
import { focusPane, leaves, openFresh, openTab, panes, PERSONAL_BROWSER } from "./panes";
import { whenLive } from "./live";
import { phone } from "./platform";
import { createStore } from "./state";
import { PAGE_TYPE } from "./store";
import { newPage } from "./templates";

export type SearchView = "search" | "pages" | "types" | "create";
export const workspaceSearch = createStore<{ view: SearchView } | null>(null);
export function openSearch(view: SearchView = "search") {
  bar.set(null);
  workspaceSearch.set({ view });
}

export function closeSearch() { workspaceSearch.set(null); void refocus(); }

// A new note belongs beside the other notes when a website has focus in a split.
export async function createNote(type = PAGE_TYPE, navigate: (show: () => void) => void = (show) => show()) {
  const { root, focus } = panes.get();
  const all = root ? leaves(root) : [];
  const here = all.find((p) => p.id === focus);
  const target = here?.page === PERSONAL_BROWSER ? all.find((p) => p.page !== PERSONAL_BROWSER) ?? here : here;
  const id = type === DAILY ? await dayPage(today()) : (await newPage(type)).id;
  navigate(() => {
    if (target && panes.get().root && leaves(panes.get().root!).some((p) => p.id === target.id)) focusPane(target.id);
    (phone ? openFresh : openTab)(id);
    if (type !== DAILY) whenLive(id, (page) => page.focus("title"));
  });
  return id;
}
