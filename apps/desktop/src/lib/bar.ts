import { useSyncExternalStore } from "react";
import { createStore } from "~/lib/state";
import { platform } from "~/lib/platform";
import { localPrefs } from "~/lib/local-prefs";
import { closePane, focusedPage, focusPane, leaves, openBeside, panes, showIn } from "~/lib/panes";
import { ASK_VIEW, FEED_VIEW, INBOX_VIEW, isPageView } from "~/lib/space";

// The bar (features/bar.feature): the strip at the window's right edge and the panel beside it.
// In a window 1000 px wide or less, its views open as panes beside the page instead.
export type BarView = "inbox" | "ask";
export type Section = "needs" | "suggested" | "captured";
export const NAMES: Record<BarView, string> = { inbox: "Inbox", ask: "Ask" };
export const PANEL = { min: 280, max: 480 };
export const bar = localPrefs("ll.bar", { open: false, view: "inbox" as BarView, pinned: false, width: 320 });
// Before the Inbox the panel was Feed, Captures or Suggestions.
if (!(bar.get().view in NAMES)) bar.set({ view: "inbox" });
// The section the Inbox scrolls to once it shows.
export const inboxAt = createStore<Section | null>(null);

const NARROW = "(max-width: 1000px)";
export const narrow = () => window.matchMedia(NARROW).matches;
export const useNarrow = () =>
  useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(NARROW);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    narrow,
  );

// The Inbox's pane keeps the Feed's id, so panes kept from before still open.
const PANE: Record<BarView, string> = { inbox: FEED_VIEW, ask: ASK_VIEW };
// A name in a sentence may be the Captures page; it opens the Inbox there.
export const sectionOf = (page: string): Section | undefined => (page === INBOX_VIEW ? "captured" : undefined);
const paneOf = (view?: BarView) => {
  const { root } = panes.get();
  const pages = view ? [PANE[view]] : Object.values(PANE);
  return root ? leaves(root).find((l) => pages.includes(l.page)) : undefined;
};

export const showing = (view: BarView) => (narrow() ? !!paneOf(view) : bar.get().open && bar.get().view === view);
export function useShowing(view: BarView) {
  bar.use();
  panes.use();
  useNarrow();
  return showing(view);
}

// Narrow, one pane holds the bar's view, as the panel does.
export function showBar(view: BarView, at?: Section) {
  if (!["macos", "browser"].includes(platform.get()) && view !== "inbox") return;
  if (at) inboxAt.set(at);
  if (!narrow()) return bar.set({ open: true, view });
  const open = paneOf(view) ?? paneOf();
  if (!open) return openBeside(PANE[view]);
  if (open.page !== PANE[view]) showIn(open.id, PANE[view]);
  focusPane(open.id);
}

export function hideBar(view: BarView) {
  if (!narrow()) return void (bar.get().view === view && bar.set({ open: false }));
  const open = paneOf(view);
  if (open) closePane(open.id);
}

export const toggleBar = (view: BarView) => (showing(view) ? hideBar(view) : showBar(view));

// The page in front, kept while a view of the bar has the keyboard, as its pane does when narrow.
let front: string | undefined;
const page = () => {
  const now = focusedPage();
  return now && isPageView(now) ? (front = now) : front;
};
panes.subscribe(page);
export const useFront = () => (panes.use(), page());
