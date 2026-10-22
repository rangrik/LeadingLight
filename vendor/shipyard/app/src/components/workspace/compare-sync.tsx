import { type RefObject, useContext, useEffect, useRef } from "react";

import type { ChatListApi } from "@/components/conversation/chat-list";
import { CompareSideContext, sendPlace, useCompareSync } from "@/lib/compare-actions";

// Sync between a Compare tab's two sides (lib/compare.ts): scrolling one
// diff takes the other to the same file, and scrolling one chat takes the
// other to the same turn. Each side says where it got to; the other goes
// there, if it has that file or turn. A move made to follow the other side
// isn't sent back. Outside a Compare tab, or with Sync off, nothing happens.

// How long a followed move takes to settle, during which this side's own
// scrolling is that move arriving, not the person's.
const SETTLE_MS = 900;

export interface Follower {
  // Sync is on for this pane.
  on: boolean;
  // This side scrolled to place at.
  moved(at: string | number): void;
}

// useFollow keeps a pane's side in step: go takes it to where the other
// side went. The returned ref's moved says where this one got to.
export function useFollow(what: "file" | "turn", go: (at: string | number) => boolean): RefObject<Follower> {
  const side = useContext(CompareSideContext);
  const last = useRef<string | number | undefined>(undefined);
  const followedAt = useRef(0);
  const goRef = useRef(go);
  goRef.current = go;
  const follower = useRef<Follower>({ on: false, moved: () => {} });
  follower.current = {
    on: !!side?.sync,
    moved: (at) => {
      if (!side?.sync || at === last.current) return;
      last.current = at;
      if (Date.now() - followedAt.current < SETTLE_MS) return;
      sendPlace(what, side.tab, side.pane, at);
    },
  };
  useEffect(() => {
    if (!side?.sync) return;
    return useCompareSync.subscribe((s, prev) => {
      const p = s[what][side.tab];
      if (!p || p === prev[what][side.tab] || p.from === side.pane) return;
      if (goRef.current(p.at)) {
        last.current = p.at;
        followedAt.current = Date.now();
      }
    });
  }, [what, side?.tab, side?.pane, side?.sync]);
  return follower;
}

// TurnSync keeps a chat in a Compare tab at the same turn as the other
// side's: the nth thing asked, counted from the start of what is loaded.
export function TurnSync<T>({ api, rows, isTurn }: { api: ChatListApi; rows: T[]; isTurn(row: T): boolean }) {
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const turnRows = () => rowsRef.current.flatMap((r, i) => (isTurn(r) ? [i] : []));
  const follow = useFollow("turn", (at) => {
    const i = turnRows()[Number(at)];
    if (i === undefined) return false;
    api.scrollToRow(i);
    api.virtualizer.scrollToIndex(i, { align: "start" });
    return true;
  });
  const sc = api.scroller;
  useEffect(() => {
    if (!sc || !follow.current.on) return;
    let frame = 0;
    const look = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = sc.getBoundingClientRect().top;
        // The first row whose foot is below the view's top is the one read.
        const seen = api
          .drawn()
          .filter((d) => d.el.getBoundingClientRect().bottom > top + 8)
          .sort((a, b) => a.index - b.index)[0];
        if (!seen) return;
        const turns = turnRows();
        let n = -1;
        for (let k = 0; k < turns.length && turns[k] <= seen.index; k++) n = k;
        if (n >= 0) follow.current.moved(n);
      });
    };
    sc.addEventListener("scroll", look, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      sc.removeEventListener("scroll", look);
    };
    // api changes every render; its scroller and rows are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc, follow.current.on]);
  return null;
}
