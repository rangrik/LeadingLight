// A Browser pane's page loads, followed from its native webview's events, so
// the pane can say when the page is loading and notice a page that keeps
// reloading itself.
//
// The webview reports three things (src-tauri/src/browser.rs):
//   - "started": a navigation is about to begin. It is the webview's
//     navigation policy, which is asked for every frame, so a page adding an
//     iframe after it has loaded reports one too, and nothing ever finishes it.
//   - "committed": the page itself (the main frame) began showing a new
//     document: a load is under way, whoever started it.
//   - "finished": the page itself finished loading.
// "user" is the app's own load (an address typed, Reload); "step" is its Back
// or Forward, which may stay in the same document and so never finish.
//
// A page that reloads itself over and over (a dev server's client reloading
// after a failed chunk load, say) never settles: after LOOP_LOADS loads of the
// same address in a row, each within LOOP_GAP_MS of the one before and none
// asked for in the app, the pane says so and offers your own browser.

export type PageEvent = { kind: "started" | "committed" | "finished" | "user" | "step"; url?: string; at: number };

export interface PageLoads {
  loading: boolean;
  // A "started" not yet followed by a commit, while the page had already
  // finished: perhaps a frame inside the page, perhaps a real navigation.
  unconfirmed?: number;
  // The page's own loads of one address, in a row.
  streak?: { url: string; count: number; at: number };
}

// How long a navigation that started after the page finished may go without
// the page committing before the spinner stops: an iframe's never will.
export const UNCONFIRMED_MS = 10_000;
export const LOOP_LOADS = 4;
export const LOOP_GAP_MS = 15_000;

export const initialPageLoads: PageLoads = { loading: false };

export function pageEvent(s: PageLoads, e: PageEvent): PageLoads {
  switch (e.kind) {
    case "user":
      return { loading: true };
    case "step":
      return { loading: true, unconfirmed: e.at };
    case "started":
      if (s.loading) return s;
      return { ...s, loading: true, unconfirmed: e.at };
    case "committed": {
      const url = sansHash(e.url ?? "");
      const prev = s.streak;
      const count = prev && prev.url === url && e.at - prev.at <= LOOP_GAP_MS ? prev.count + 1 : 1;
      return { loading: true, streak: { url, count, at: e.at } };
    }
    case "finished":
      return { ...s, loading: false, unconfirmed: undefined };
  }
}

// settle stops a spinner that only an unconfirmed "started" turned on, and
// forgets a loop once the page has stayed put for LOOP_GAP_MS.
export function settle(s: PageLoads, now: number): PageLoads {
  let out = s;
  if (out.unconfirmed !== undefined && now - out.unconfirmed >= UNCONFIRMED_MS) out = { ...out, loading: false, unconfirmed: undefined };
  if (!out.loading && out.streak && now - out.streak.at > LOOP_GAP_MS) out = { ...out, streak: undefined };
  return out;
}

// reloadLoop is the address the page keeps reloading, and how many times.
export function reloadLoop(s: PageLoads): { url: string; count: number } | undefined {
  return s.streak && s.streak.count >= LOOP_LOADS ? { url: s.streak.url, count: s.streak.count } : undefined;
}

function sansHash(url: string): string {
  const i = url.indexOf("#");
  return i < 0 ? url : url.slice(0, i);
}
