import { citesIn } from "@leadinglight/editor/editor";
import { toastManager } from "@leadinglight/ui/components/toast";
import { useEffect } from "react";
import { pageLabel } from "./labels";
import { childOf, createChild, parentOf, parseHref } from "./linked";
import { openLink } from "./links";
import { editPage, isLive, whenLive } from "./live";
import { objects } from "./objects";
import { focusPane, leaves, openPage, panes, placePage } from "./panes";
import { pageOf } from "./space";
import { createStore } from "./state";

// A page and its essay side by side (DECISIONS.md, 11): writing one, quoting into it, following
// its quotes back, and opening the in-app links between them.

const leafOf = (page: string) => {
  const { root } = panes.get();
  return root ? leaves(root).find((l) => l.page === page) : undefined;
};

// The width a pane needs for its page: one with sidenotes needs room for its margin.
export const PLAIN_NEED = 520;
export const paneNeed = (page: string) => (pageOf(page)?.properties.thoughts ? 832 : PLAIN_NEED);

// Asks the shell to fold the sidebar: sidenotes and essays want the room.
export const makeRoom = () => window.dispatchEvent(new Event("ll:make-room"));

// Opens the page's essay (made the first time) beside the page. `stay` keeps the keyboard in the
// page, as when quoting from it.
export async function openEssay(source: string, stay = false) {
  const page = pageOf(source);
  if (!page) return;
  let essay = childOf(page, "essay");
  if (!essay) {
    essay = (await createChild(source, "essay")).id;
    await editPage(source, { properties: (p) => ({ ...p, essay }) });
  }
  if (!leafOf(source)) openPage(source);
  const here = leafOf(source);
  if (here) placePage(essay, here.id, "right");
  if (stay && here) focusPane(here.id);
  makeRoom();
  return essay;
}

// Quotes words from `source` into its essay, opening the essay if needed.
export async function quoteInto(source: string, quote: { text: string; id: string }) {
  const page = pageOf(source);
  const essay = page && childOf(page, "essay");
  if (!essay) return;
  if (!leafOf(essay)) await openEssay(source, true);
  whenLive(essay, (live) => live.insertQuote({ ...quote, href: `ll:${source}#${quote.id}`, label: pageLabel(pageOf(source)?.title ?? "") }));
  // A folded essay says where the quote went.
  if (document.querySelector(`[data-pane-page="${CSS.escape(essay)}"][data-folded]`))
    toastManager.add({ type: "success", title: "Added to the essay", description: `Quoted in “${pageLabel(pageOf(essay)?.title ?? "") || "Essay"}”.` });
}

// Which quotes each page's essay holds, by page id: an open essay reports its own, else they're
// read from the stored essay. A page with no essay holds none.
const quotes = createStore<Record<string, string[]>>({});
export const reportQuotes = (source: string, ids: string[]) => quotes.set({ ...quotes.get(), [source]: ids });

export function useQuotes(source: string, essay: string | undefined): string[] | null {
  const all = quotes.use();
  useEffect(() => {
    if (!essay) return reportQuotes(source, []);
    if (isLive(essay)) return;
    let stale = false;
    objects
      .get(essay)
      .then((obj) => !stale && reportQuotes(source, citesIn(obj?.content)))
      .catch(console.error);
    return () => {
      stale = true;
    };
  }, [source, essay]);
  return all[source] ?? null;
}

// In-app links open their page (an essay beside its page, when that is open) and scroll to the
// anchor; any other link opens outside.
export function openHref(href: string) {
  const target = parseHref(href);
  if (!target) return openLink(href);
  const open = leafOf(target.page);
  const parent = pageOf(target.page) && parentOf(pageOf(target.page)!);
  const beside = parent ? leafOf(parent) : undefined;
  if (open) focusPane(open.id);
  else if (beside) placePage(target.page, beside.id, "right");
  else openPage(target.page);
  if (target.anchor) whenLive(target.page, (live) => requestAnimationFrame(() => live.reveal(target.anchor!)));
}
