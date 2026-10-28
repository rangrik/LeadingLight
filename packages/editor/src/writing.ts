import { Extension, getChangedRanges } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { isSpelling, onMistakes } from "./grammar";
import { grammarMistakes, grammarText, mapGrammarKept } from "./grammar-prose";
import { STYLE_WORDS } from "./style-words";

export { isSpelling } from "./grammar";
export { collectGrammarIssues, applyGrammarIssue, keepGrammarIssue, grammarIssueIsCurrent, onGrammarChange, addGrammarWord, grammarWords, removeGrammarWord, retryGrammarCheck } from "./grammar-review";
export type { GrammarIssue, GrammarReview } from "./grammar-review";

// iA Writer's editor aids (features/writing.feature). They only decorate: the page never changes.
export type Part = "noun" | "verb" | "adjective" | "adverb" | "conjunction";
export type Check = keyof typeof STYLE_WORDS;
export type Writing = {
  // Focus mode keeps the line in the middle; Sentence and Paragraph also dim the rest.
  focus: "sentence" | "paragraph" | "typewriter" | null;
  syntax: Part[];
  style: Check[];
  grammar: boolean;
  quiet?: boolean;
};

export const PARTS: Part[] = ["noun", "verb", "adjective", "adverb", "conjunction"];
export const CHECKS = Object.keys(STYLE_WORDS) as Check[];
export const OFF: Writing = { focus: null, syntax: [], style: [], grammar: false };
const LABEL: Record<Check, string> = { filler: "Filler", redundancy: "Redundancy", cliche: "Cliché" };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = Object.fromEntries(
  CHECKS.map((check) => {
    const phrases = [...STYLE_WORDS[check]].sort((a, b) => b.length - a.length).map((p) => escape(p).replace(/[ -]/g, "[\\s-]+"));
    return [check, new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.join("|")})(?![\\p{L}\\p{N}])`, "giu")];
  }),
) as Record<Check, RegExp>;

const plainText = grammarText;

// The part-of-speech tagger (compromise, about 120 kB) loads the first time it is needed.
type Tagged = { from: number; to: number; part: Part };
let tag: ((text: string) => Tagged[]) | null = null;
let loading: Promise<void> | null = null;
const TAGS: [string, Part][] = [
  ["Conjunction", "conjunction"],
  ["Adverb", "adverb"],
  ["Adjective", "adjective"],
  ["Verb", "verb"],
  ["Noun", "noun"],
];
const partOf = (tags: string[]) => (tags.includes("Pronoun") ? undefined : TAGS.find(([t]) => tags.includes(t))?.[1]);
// Told when the tagger arrives (null) or when Harper has read some texts.
type Found = (texts: Set<string> | null) => void;
const taggerWaiters = new Set<Found>();
export function onFound(listener: Found) {
  taggerWaiters.add(listener);
  const off = onMistakes(listener);
  return () => {
    taggerWaiters.delete(listener);
    off();
  };
}
const loadTagger = () =>
  (loading ??= import("compromise/two").then(({ default: nlp }) => {
    tag = (text) => {
      const out: Tagged[] = [];
      let at = 0;
      for (const sentence of nlp(text).json() as { terms: { text: string; tags: string[] }[] }[])
        for (const term of sentence.terms) {
          // Found in the text rather than counted, so a stray offset can't shift every colour after it.
          const i = term.text ? text.indexOf(term.text, at) : -1;
          if (i < 0) continue;
          at = i + term.text.length;
          const part = partOf(term.tags);
          if (part) out.push({ from: i, to: at, part });
        }
      return out;
    };
    taggerWaiters.forEach((l) => l(null));
  }));

const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;
const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });
const measure = (text: string) => ({
  words: text.match(WORD)?.length ?? 0,
  characters: text.length,
  sentences: [...sentences.segment(text)].filter((s) => /[\p{L}\p{N}]/u.test(s.segment)).length,
  filled: /\S/.test(text),
});

// What a text block holds, worked out once per block: a block an edit didn't touch keeps its node.
type Analysis = ReturnType<typeof measure> & {
  block: PMNode;
  text: string;
  prose: boolean;
  style: { from: number; to: number; check: Check }[];
  tagged?: Tagged[];
};
const analyses = new WeakMap<PMNode, Analysis>();
function analyse(block: PMNode): Analysis {
  let a = analyses.get(block);
  if (a) return a;
  const { text } = plainText(block);
  const prose = !block.type.spec.code;
  const style = prose ? CHECKS.flatMap((check) => [...text.matchAll(PATTERN[check])].map((m) => ({ from: m.index, to: m.index + m[0].length, check }))) : [];
  a = { block, ...measure(block.textBetween(0, block.content.size, "\n", " ")), text, prose, style, tagged: prose ? undefined : [] };
  analyses.set(block, a);
  return a;
}
// Harper reads blanked code as a run of spaces, so what it finds there is dropped.
const mistakesOf = (a: Analysis, pos: number, doc: PMNode) =>
  a.prose ? grammarMistakes(a.block, pos, doc) : [];
// Tagging a long page at once would freeze it, so counting can stop at a deadline and go on later.
const tagsOf = (a: Analysis, deadline = Infinity) => (a.tagged ??= tag && performance.now() < deadline ? tag(a.text) : undefined);

function checkBlock(block: PMNode, pos: number, writing: Writing, doc: PMNode): Decoration[] {
  const a = analyse(block);
  const at = pos + 1;
  const decos: Decoration[] = [];
  if (writing.syntax.length)
    for (const { from, to, part } of tagsOf(a) ?? []) if (writing.syntax.includes(part)) decos.push(Decoration.inline(at + from, at + to, { class: `ll-${part}` }));
  for (const { from, to, check } of a.style)
    if (writing.style.includes(check)) decos.push(Decoration.inline(at + from, at + to, { class: "ll-style", "data-tip": LABEL[check] }));
  if (writing.grammar)
    for (const m of mistakesOf(a, pos, doc) ?? [])
      decos.push(Decoration.inline(at + m.from, at + m.to, { class: isSpelling(m.kind) ? "ll-spelling" : "ll-grammar", "data-tip": m.message }));
  return decos;
}

const marking = (w: Writing) => w.syntax.length > 0 || w.style.length > 0 || w.grammar;

function checkAll(doc: PMNode, writing: Writing): DecorationSet {
  if (!marking(writing)) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) decos.push(...checkBlock(node, pos, writing, doc));
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decos);
}

// The CSS dims every top-level block but the ones marked lit. Inside the line's block, the blocks
// beside the path down to it are dimmed, and in Sentence mode the rest of the line. One mark at
// the top, not a dim on each block: a set of thousands is rebuilt slowly per key.
function focusDims(state: EditorState, mode: "sentence" | "paragraph"): Decoration[] {
  const { $head, from, to } = state.selection;
  // Selected blocks or an embed: what is selected stays lit.
  if (!$head.parent.isTextblock) {
    const lit: Decoration[] = [];
    state.doc.forEach((node, pos) => {
      if (pos < to && pos + node.nodeSize > from) lit.push(Decoration.node(pos, pos + node.nodeSize, { class: "ll-lit" }));
    });
    return lit;
  }
  const top = $head.before(1);
  const dims = [Decoration.node(top, top + $head.node(1).nodeSize, { class: "ll-lit" })];
  for (let d = 2; d <= $head.depth; d++) {
    const start = $head.start(d - 1);
    const keep = $head.index(d - 1);
    $head.node(d - 1).forEach((child, offset, i) => {
      if (i !== keep) dims.push(Decoration.node(start + offset, start + offset + child.nodeSize, { class: "ll-dim" }));
    });
  }
  if (mode === "sentence" && !$head.parent.type.spec.code) {
    const { text } = plainText($head.parent);
    let from = 0;
    let to = text.length;
    for (const { index, segment } of sentences.segment(text)) {
      [from, to] = [index, index + segment.length];
      if ($head.parentOffset < to) break;
    }
    const at = $head.start();
    if (from > 0) dims.push(Decoration.inline(at, at + from, { class: "ll-dim" }));
    if (to < text.length) dims.push(Decoration.inline(at + to, at + text.length, { class: "ll-dim" }));
  }
  return dims;
}

function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

// Typewriter: the line with the cursor sits in the middle of the scrolling page.
function center(view: EditorView) {
  const box = scroller(view.dom);
  if (!box) return;
  const caret = view.coordsAtPos(view.state.selection.head);
  const rect = box.getBoundingClientRect();
  const off = (caret.top + caret.bottom) / 2 - (rect.top + rect.height / 2);
  if (Math.abs(off) > 1) box.scrollTop += off;
}

const dimming = (state: EditorState) => {
  const { focus } = writingKey.getState(state)!.writing;
  return focus === "sentence" || focus === "paragraph" ? focus : null;
};

// Edited blocks wait for a pause in typing to be checked again: redrawing the words around
// the cursor on every key makes the browser's own typing slow.
const RECHECK_MS = 400;

// Spans edited since the last check, kept in step with the document.
type Span = { from: number; to: number };
type WritingState = { writing: Writing; checks: DecorationSet; dirty: Span[] };
// A new Writing, "rebuild" (the tagger came), "recheck" (typing paused) or texts Harper has read.
type Meta = Writing | "rebuild" | "recheck" | Set<string>;
export const writingKey = new PluginKey<WritingState>("writing");

function recheck(doc: PMNode, { writing, checks }: WritingState, blocks: (node: PMNode, pos: number) => boolean, from = 0, to = doc.content.size) {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (blocks(node, pos)) checks = checks.remove(checks.find(pos + 1, pos + node.nodeSize - 1)).add(doc, checkBlock(node, pos, writing, doc));
    return false;
  });
  return checks;
}

// Set from outside with tr.setMeta(writingKey, writing).
export const WritingAids = Extension.create({
  name: "writing",
  addProseMirrorPlugins() {
    // Only keys move the page: a click or a drag must not scroll it from under the pointer.
    let byKey = false;
    let memo: { state: EditorState; set: DecorationSet } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    return [
      new Plugin<WritingState>({
        key: writingKey,
        state: {
          init: () => ({ writing: OFF, checks: DecorationSet.empty, dirty: [] }),
          apply(tr, value, old, state) {
            if (tr.docChanged) mapGrammarKept(old.doc, state.doc, tr.mapping);
            const meta = tr.getMeta(writingKey) as Meta | undefined;
            if (meta === "recheck") {
              let checks = value.checks;
              for (const r of value.dirty)
                checks = recheck(state.doc, { ...value, checks }, () => true, Math.max(0, r.from - 1), Math.min(state.doc.content.size, r.to + 1));
              return { ...value, checks, dirty: [] };
            }
            if (meta instanceof Set) return { ...value, checks: recheck(state.doc, value, (node) => meta.has(analyse(node).text)) };
            if (meta) {
              const writing = meta === "rebuild" ? value.writing : meta;
              return { writing, checks: checkAll(state.doc, writing), dirty: [] };
            }
            const { writing } = value;
            if (!tr.docChanged || !marking(writing)) return value;
            const dirty = value.dirty.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to) }));
            for (const { newRange } of getChangedRanges(tr)) dirty.push(newRange);
            return { writing, checks: value.checks.map(tr.mapping, tr.doc), dirty };
          },
        },
        props: {
          // Harper checks spelling too, so the browser's own red underline would be a second one.
          attributes: (state): Record<string, string> => ({
            ...(dimming(state) && { class: "ll-focusing" }),
            ...((writingKey.getState(state)!.writing.grammar || writingKey.getState(state)!.writing.quiet) && { spellcheck: "false" }),
          }),
          decorations(state) {
            const { checks } = writingKey.getState(state)!;
            const mode = dimming(state);
            if (!mode) return checks;
            if (memo?.state !== state) memo = { state, set: checks.add(state.doc, focusDims(state, mode)) };
            return memo.set;
          },
          handleDOMEvents: {
            keydown: () => {
              byKey = true;
              return false;
            },
            mousedown: () => {
              byKey = false;
              return false;
            },
          },
        },
        view: (view) => {
          // Not mid-composition: redrawing under an input method can break what it is typing.
          const send = (meta: Meta) => {
            if (view.isDestroyed) return;
            if (view.composing) timer = setTimeout(() => send(meta), RECHECK_MS);
            else view.dispatch(view.state.tr.setMeta(writingKey, meta));
          };
          const off = onFound((texts) => {
            const { writing } = writingKey.getState(view.state)!;
            if (texts ? writing.grammar : writing.syntax.length) send(texts ?? "rebuild");
          });
          return {
            destroy: () => {
              clearTimeout(timer);
              off();
            },
            update(view, prev) {
              const { writing, dirty } = writingKey.getState(view.state)!;
              if (dirty.length && view.state.doc !== prev.doc) {
                clearTimeout(timer);
                timer = setTimeout(() => send("recheck"), RECHECK_MS);
              }
              if (writing.syntax.length && !tag) loadTagger().catch(console.error);
              if (!writing.focus || !view.hasFocus()) return;
              const turnedOn = !writingKey.getState(prev)!.writing.focus;
              const moved = view.state.doc !== prev.doc || !view.state.selection.eq(prev.selection);
              if (turnedOn || (byKey && moved)) center(view);
            },
          };
        },
      }),
    ];
  },
});

// Everything counted between two positions, for the counts by the page's name. Parts of speech
// and grammar are null until the tagger and Harper have read the text; done is false when tagging
// stopped at the deadline and should go on.
export type Count = Omit<ReturnType<typeof measure>, "filled"> & {
  paragraphs: number;
  parts: Record<Part, number> | null;
  style: Record<Check, number>;
  grammar: Record<string, number> | null;
};
const zero = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function countText(doc: PMNode, from = 0, to = doc.content.size, deadline = Infinity): { count: Count; done: boolean } {
  if (!tag) loadTagger().catch(console.error);
  const c = { words: 0, characters: 0, sentences: 0, paragraphs: 0, parts: zero(PARTS), style: zero(CHECKS), grammar: {} as Record<string, number> };
  let parts = Boolean(tag);
  let grammar = true;
  let done = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const a = analyse(node);
    const lo = Math.max(0, from - pos - 1);
    const hi = Math.min(node.content.size, to - pos - 1);
    const m = lo === 0 && hi === node.content.size ? a : measure(node.textBetween(lo, hi, "\n", " "));
    c.words += m.words;
    c.characters += m.characters;
    c.sentences += m.sentences;
    if (m.filled) c.paragraphs++;
    const inside = (f: { from: number; to: number }) => f.from >= lo && f.to <= hi;
    const tagged = parts ? tagsOf(a, deadline) : undefined;
    if (parts && !tagged) [parts, done] = [false, false];
    for (const t of tagged ?? []) if (inside(t)) c.parts[t.part]++;
    for (const f of a.style) if (inside(f)) c.style[f.check]++;
    // Asked of every block, so Harper starts reading all of them at once.
    const mistakes = mistakesOf(a, pos, doc);
    if (!mistakes) grammar = false;
    for (const f of mistakes ?? []) if (inside(f)) c.grammar[f.kind] = (c.grammar[f.kind] ?? 0) + 1;
    return false;
  });
  return { count: { ...c, parts: parts ? c.parts : null, grammar: grammar ? c.grammar : null }, done };
}
