import type { TranscriptItem } from "@/lib/transcript";

// The chat side of mock mode's visual diffs (their manifests are in
// mock-vdiff.ts, loaded with the artifacts when first asked).

export const VD_ID = "46ab3c4e1b";
export const VD_CLEAR_ID = "39fdf22244";

let n = 0;
const id = () => `mock-vdchat-${++n}`;
const run = (target: string): TranscriptItem => ({ kind: "tools", id: id(), verb: "Run", done: true, items: [{ verb: "Run", target }] });

// The turn where the agent checked its UI change.
export function vdiffChat(): TranscriptItem[] {
  return [
    { kind: "user", id: id(), text: "Put search in the hero and add in-stock badges and filters to /search. Check nothing else moved." },
    run("berthd shots baseline"),
    { kind: "edit", id: id(), file: "pages/search.html", added: 48, removed: 9 },
    run('berthd shots compare --note "first pass"'),
    { kind: "artifact", id: id(), tool: "vd-1", text: "Visual changes: search-perf vs main", local: VD_ID, version: 1, done: true },
    { kind: "text", id: id(), text: "Two things I didn't mean: **/search scrolls sideways at 375** (the filters sidebar doesn't collapse) and **/account fails** with a 500. Fixing both." },
    { kind: "edit", id: id(), file: "pages/search.html", added: 12, removed: 4 },
    run('berthd shots compare --note "filters collapse on phones; account fixed"'),
    { kind: "artifact", id: id(), tool: "vd-2", text: "Visual changes: search-perf vs main", local: VD_ID, version: 2, done: true, updated: true },
    { kind: "text", id: id(), text: "Fixed. What's left is meant: the hero's search field (it re-wraps the headline on desktop), the badges and filters on /search, and the new /deals page. Accept it as the baseline if it looks right." },
    run("berthd shots compare --base accepted"),
    { kind: "artifact", id: id(), tool: "vd-3", text: "Visual changes: search-perf vs accepted", local: VD_CLEAR_ID, version: 1, done: true },
  ];
}
