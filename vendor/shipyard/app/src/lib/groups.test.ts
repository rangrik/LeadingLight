// node --experimental-strip-types --test src/lib/groups.test.ts (pnpm test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { assignTones, foldedOf, groupsOf, hashTone, labelsFor, nameFromKey, stepGroup, stripTabs, TONES, withGroup, withoutGroup } from "./groups.ts";

const keys = Array.from({ length: 40 }, (_, i) => `devl:/home/me/work/shop-${i}`);

test("a worktree's tone is the same every time", () => {
  for (const k of keys) assert.equal(hashTone(k), hashTone(k));
  // Spread over the palette (all but copper, kept for a crowd), not piled
  // on one tone.
  assert.equal(new Set(keys.map(hashTone)).size, TONES.length - 1);
  assert.ok(!keys.some((k) => TONES[hashTone(k)] === "copper"));
});

test("worktrees on screen never share a tone, or one close to it, while there are enough", () => {
  for (let i = 0; i + 1 < keys.length; i++) {
    const got = assignTones([keys[i], keys[i + 1]]);
    assert.notEqual(got[keys[i]], got[keys[i + 1]]);
    const pair = new Set([got[keys[i]], got[keys[i + 1]]]);
    assert.ok(!(pair.has("violet") && pair.has("magenta")) && !(pair.has("magenta") && pair.has("pink")), [...pair].join("+"));
  }
  const six = assignTones(keys.slice(0, 6));
  assert.equal(new Set(Object.values(six)).size, 6);
  // The first keeps its own: adding a second never recolours the first.
  assert.equal(assignTones([keys[0], keys[1]])[keys[0]], TONES[hashTone(keys[0])]);
});

test("a picked tone wins, and the others move out of its way", () => {
  const own = TONES[hashTone(keys[1])];
  const got = assignTones([keys[0], keys[1]], { [keys[0]]: own });
  assert.equal(got[keys[0]], own);
  assert.notEqual(got[keys[1]], own);
  // Something that is not a tone is ignored.
  assert.equal(assignTones([keys[0]], { [keys[0]]: "plaid" })[keys[0]], TONES[hashTone(keys[0])]);
});

test("labels add the box only when two on screen share a name", () => {
  const got = labelsFor([
    { key: "devl:/w/search-perf", name: "search-perf", box: "devl" },
    { key: "gpu:/w/search-perf", name: "search-perf", box: "gpu" },
    { key: "devl:/w/checkout-fix", name: "checkout-fix", box: "devl" },
  ]);
  assert.deepEqual(got, { "devl:/w/search-perf": "search-perf · devl", "gpu:/w/search-perf": "search-perf · gpu", "devl:/w/checkout-fix": "checkout-fix" });
  assert.equal(nameFromKey("devl:/home/me/work/shop-search-perf"), "shop-search-perf");
});

const [A, B, C] = ["devl:/a", "devl:/b", "gpu:/c"];

test("the strip always holds the worktree in front", () => {
  assert.deepEqual(groupsOf(undefined, A), [A]);
  assert.deepEqual(groupsOf([A, B], B), [A, B]);
  // Picked on its own (a plain click elsewhere): alone.
  assert.deepEqual(groupsOf([A, B], C), [C]);
  // A worktree that is gone leaves; duplicates are dropped.
  assert.deepEqual(groupsOf([A, B, B, C], A, (k) => k !== C), [A, B]);
  assert.deepEqual(groupsOf([A], undefined), []);
});

test("adding a group puts it last and in front; adding one already there just fronts it", () => {
  assert.deepEqual(withGroup({ shown: [A], current: A }, B), { shown: [A, B], current: B });
  assert.deepEqual(withGroup({ shown: [A, B], current: B }, A), { shown: [A, B], current: A });
  // From one worktree that was never grouped.
  assert.deepEqual(withGroup({ shown: [], current: A }, B), { shown: [A, B], current: B });
  // Dropped between two groups.
  assert.deepEqual(withGroup({ shown: [A, B], current: A }, C, 1), { shown: [A, C, B], current: C });
  assert.deepEqual(withGroup({ shown: [A, B], current: A }, C, 0), { shown: [C, A, B], current: C });
});

test("closing a group fronts its neighbour, and leaves the worktree alone", () => {
  assert.deepEqual(withoutGroup({ shown: [A, B, C], current: B }, B), { shown: [A, C], current: C });
  assert.deepEqual(withoutGroup({ shown: [A, B, C], current: C }, C), { shown: [A, B], current: B });
  assert.deepEqual(withoutGroup({ shown: [A, B, C], current: A }, C), { shown: [A, B], current: A });
  assert.deepEqual(withoutGroup({ shown: [A], current: A }, A), { shown: [], current: undefined });
});

test("group navigation goes round", () => {
  assert.equal(stepGroup({ shown: [A, B, C], current: C }, 1), A);
  assert.equal(stepGroup({ shown: [A, B, C], current: A }, -1), C);
  assert.equal(stepGroup({ shown: [A], current: A }, 1), A);
});

test("folding: by hand, or every other group when narrow; never the one in front", () => {
  assert.deepEqual(foldedOf({ shown: [A, B, C], current: A }, [B, A], false), [B]);
  assert.deepEqual(foldedOf({ shown: [A, B, C], current: B }, [], true), [A, C]);
  assert.deepEqual(foldedOf({ shown: [A], current: A }, [A], true), []);
});

test("⌘1–9 count the tabs of every unfolded group, in order", () => {
  const t = (id: string) => ({ id });
  const got = stripTabs([
    { key: A, tabs: [t("a1"), t("a2")], folded: false },
    { key: B, tabs: [t("b1")], folded: true },
    { key: C, tabs: [t("c1")], folded: false },
  ]);
  assert.deepEqual(got.map((x) => x.tab.id), ["a1", "a2", "c1"]);
  assert.equal(got[2].key, C);
});

// The Compare tab (lib/compare.ts).

import { findCompare, focusedSide, kindOf, laneSide, newCompare, pathOf, rehomeCompares, setLane, shownSides, sides, swapSides, syncPreview, withPath, type CompareTab, type Kind } from "./compare.ts";
import { leaves as allLeaves, paneWorktree as ownerOf } from "./layout.ts";

const KA = "devl:/w/checkout-fix";
const KB = "devl:/w/search-perf";
// make records what it was asked for, so a test can see what was made anew.
function maker() {
  const made: string[] = [];
  const make = (kind: Kind, side: string) => {
    made.push(`${kind}:${side}`);
    if (kind === "agent") return { kind: "terminal" as const, box: "devl", session: `${side.split("/").pop()}-claude` };
    if (kind === "diff") return { kind: "panel" as const, plugin: "diff", panel: "diff", title: "Diff" };
    return { kind: "browser" as const, url: side === KA ? "http://localhost:3001/" : "http://localhost:3000/" };
  };
  return { made, make };
}
const content = (t: CompareTab) => sides(t)!.map((l) => l.content);

test("a Compare tab holds a pane of each worktree, left and right, the right one a guest", () => {
  const { make } = maker();
  const t = newCompare(KA, KA, KB, "chat", make);
  const [l, r] = sides(t)!;
  assert.equal(ownerOf(KA, l), KA);
  assert.equal(ownerOf(KA, r), KB);
  assert.equal(r.wt, KB);
  assert.equal(l.wt, undefined);
  assert.equal(t.focus, l.id);
  assert.deepEqual(content(t).map((c) => c.kind === "terminal" && c.view), ["conversation", "conversation"]);
  assert.deepEqual(t.compare.panes, { agent: [l.id, r.id] });
});

test("Chat and Terminal are one pane per side, seen two ways; nothing is made again", () => {
  const { make, made } = maker();
  const t = newCompare(KA, KA, KB, "chat", make);
  const ids = sides(t)!.map((l) => l.id);
  const u = setLane(t, KA, "terminal", make);
  assert.deepEqual(sides(u)!.map((l) => l.id), ids);
  assert.deepEqual(content(u).map((c) => c.kind === "terminal" && c.view), ["terminal", "terminal"]);
  assert.equal(made.length, 2);
  assert.equal(u.compare!.lane, "terminal");
});

test("another lane parks the panes showing and brings them back as they were", () => {
  const { make, made } = maker();
  const t = newCompare(KA, KA, KB, "chat", make);
  const chat = sides(t)!.map((l) => l.id);
  const d = setLane(t, KA, "diff", make);
  assert.deepEqual(content(d).map((c) => c.kind), ["panel", "panel"]);
  assert.deepEqual(d.compare!.parked!.map((l) => l.id), chat);
  const p = setLane(d, KA, "preview", make);
  assert.equal(p.compare!.parked!.length, 4);
  const back = setLane(p, KA, "chat", make);
  assert.deepEqual(sides(back)!.map((l) => l.id), chat);
  assert.equal(back.compare!.parked!.length, 4);
  const again = setLane(back, KA, "diff", make);
  assert.deepEqual(sides(again)!.map((l) => l.id), sides(d)!.map((l) => l.id));
  // Two at the start, then two for Diff and two for Preview, once each.
  assert.equal(made.length, 6);
  // Every pane is still somewhere: none was dropped on the way.
  assert.equal(allLeaves(again.root).length + again.compare!.parked!.length, 6);
});

test("the side with the focus keeps it across lanes and swaps", () => {
  const { make } = maker();
  let t = newCompare(KA, KA, KB, "chat", make);
  t = { ...t, focus: sides(t)![1].id };
  assert.equal(focusedSide(t), 1);
  const d = setLane(t, KA, "diff", make);
  assert.equal(focusedSide(d), 1);
  assert.equal(laneSide(d, d.focus), 1);
});

test("swapping trades sides, lanes' pairs and keys, and remakes nothing", () => {
  const { make, made } = maker();
  const t = setLane(newCompare(KA, KA, KB, "chat", make), KA, "diff", make);
  const [l, r] = sides(t)!;
  const s = swapSides(t);
  assert.deepEqual(sides(s)!.map((x) => x.id), [r.id, l.id]);
  assert.equal(s.compare!.a, KB);
  assert.equal(s.compare!.b, KA);
  assert.deepEqual(s.compare!.panes!.agent, [...t.compare!.panes!.agent!].reverse());
  // The panes still belong to the worktrees they did.
  assert.equal(ownerOf(KA, sides(s)![0]), KB);
  const back = setLane(s, KA, "chat", make);
  assert.equal(ownerOf(KA, sides(back)![0]), KB);
  assert.equal(made.length, 4);
  assert.deepEqual(swapSides(s).compare, t.compare);
});

test("a page's path moves to the same place on the other server", () => {
  assert.equal(pathOf("http://localhost:3001/search?q=boots#top"), "/search?q=boots#top");
  assert.equal(withPath("http://checkout-fix.shop.devl.localhost:1377/", "/search?q=boots"), "http://checkout-fix.shop.devl.localhost:1377/search?q=boots");
  assert.equal(pathOf("not a url"), undefined);
  const { make } = maker();
  const t = setLane(newCompare(KA, KA, KB, "chat", make), KA, "preview", make);
  // Both at / to start: that is the shared place.
  const start = syncPreview(t)!;
  assert.equal(start.compare!.path, "/");
  assert.equal(syncPreview(start), undefined);
  // The left side goes to /search?q=boots: the right follows.
  const [l, r] = sides(start)!;
  const moved = { ...start, root: { ...(start.root as Extract<CompareTab["root"], { kind: "split" }>), a: { ...l, content: { kind: "browser" as const, url: "http://localhost:3001/search?q=boots" } } } };
  const s = syncPreview(moved)!;
  assert.deepEqual(content(s).map((c) => c.kind === "browser" && c.url), ["http://localhost:3001/search?q=boots", "http://localhost:3000/search?q=boots"]);
  assert.equal(s.compare!.path, "/search?q=boots");
  assert.equal(sides(s)![1].id, r.id);
  assert.equal(syncPreview(s), undefined);
  // Off, or in another lane, nothing follows.
  assert.equal(syncPreview({ ...moved, compare: { ...moved.compare!, sync: false } }), undefined);
  // A side just sent somewhere doesn't lead.
  const right = { ...start, root: { ...(start.root as Extract<CompareTab["root"], { kind: "split" }>), b: { ...r, content: { kind: "browser" as const, url: "http://localhost:3000/b" } } } };
  assert.equal(syncPreview(right, (side) => side === 1), undefined);
  assert.equal(sides(syncPreview(right)!)![0].content.kind === "browser" && (sides(syncPreview(right)!)![0].content as { url: string }).url, "http://localhost:3001/b");
});

test("the Compare tab of two worktrees is found either way round", () => {
  const { make } = maker();
  const t = newCompare(KA, KA, KB, "diff", make);
  const spaces = { [KA]: { tabs: [t] }, [KB]: { tabs: [] as CompareTab[] } };
  assert.equal(findCompare(spaces, KB, KA)?.tab.id, t.id);
  assert.equal(findCompare(spaces, KA, "devl:/w/other"), undefined);
  assert.equal(kindOf("terminal"), "agent");
});

test("when its first worktree goes, a Compare tab moves to the other's tabs, panes keeping their worktrees", () => {
  const { make } = maker();
  const t = setLane(newCompare(KA, KA, KB, "chat", make), KA, "diff", make);
  const spaces = { [KA]: { tabs: [t], active: t.id }, [KB]: { tabs: [] as CompareTab[], active: undefined } };
  const out = rehomeCompares(spaces, KA);
  const moved = out[KB].tabs[0];
  assert.equal(moved.id, t.id);
  const [l, r] = sides(moved)!;
  assert.equal(ownerOf(KB, l), KA);
  assert.equal(ownerOf(KB, r), KB);
  assert.equal(r.wt, undefined);
  assert.ok(moved.compare!.parked!.every((p) => ownerOf(KB, p) === ownerOf(KA, t.compare!.parked!.find((x) => x.id === p.id)!)));
  // With nowhere to go it stays, to go with its workspace.
  assert.equal(rehomeCompares({ [KA]: { tabs: [t] } }, KA)[KA].tabs.length, 1);
});

test("a side that is gone or away leaves the other to fill the tab", () => {
  assert.deepEqual(shownSides(["ok", "ok"]), [true, true]);
  assert.deepEqual(shownSides(["gone", "ok"]), [false, true]);
  assert.deepEqual(shownSides(["ok", "away"]), [true, false]);
  // Both down: both show, each saying why.
  assert.deepEqual(shownSides(["away", "gone"]), [true, true]);
});

// Tones on every built-in theme (themes/tones.ts): text that reads, and a
// colour that stays clear of the theme's state colours.

import { builtinThemes } from "../themes/builtin.ts";
import { distance } from "../themes/color.ts";
import { stateColours, TONE_APART, TONE_TEXT, toneChecks, toneColors } from "../themes/tones.ts";

for (const theme of builtinThemes) {
  test(`worktree tones read on ${theme.name}`, () => {
    const tones = toneColors(theme);
    const bad: string[] = [];
    for (const [t, v] of Object.entries(tones)) {
      for (const c of toneChecks(v, theme)) if (c.value < TONE_TEXT) bad.push(`${t} ${c.what}: ${c.value.toFixed(2)}`);
      for (const s of stateColours(theme)) {
        const d = distance(v, s);
        if (d < TONE_APART) bad.push(`${t} too near ${s}: ${d.toFixed(3)}`);
      }
    }
    // Two tones side by side never look alike.
    const list = Object.entries(tones);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (distance(list[i][1], list[j][1]) < 0.06) bad.push(`${list[i][0]} near ${list[j][0]}`);
    assert.deepEqual(bad, []);
  });
}
