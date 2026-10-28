import type { Linter } from "harper.js";

// Harper runs locally in a worker; only plain, owned values leave its WASM objects.
export type Mistake = { from: number; to: number; kind: string; rule: string; message: string; suggestions: string[] };
export const isSpelling = (kind: string) => kind === "Spelling" || kind === "Typo";
const WORDS_KEY = "ll.grammar.words";
let words: string[];
try { words = JSON.parse(localStorage.getItem(WORDS_KEY) ?? "[]").filter((w: unknown) => typeof w === "string"); }
catch { words = []; }

let linter: Promise<Linter> | null = null;
let revision = 0;
const found = new Map<string, Mistake[]>();
const errors = new Map<string, string>();
const waiting = new Map<string, number>();
const listeners = new Set<(texts: Set<string>) => void>();
let arrived = new Set<string>();
let telling: ReturnType<typeof setTimeout> | undefined;

const start = () =>
  (linter ??= Promise.all([import("harper.js"), import("harper.js/binary")]).then(async ([harper, { binary }]) => {
    const { Dialect } = harper;
    const region: Record<string, number> = { GB: Dialect.British, AU: Dialect.Australian, CA: Dialect.Canadian, IN: Dialect.Indian };
    const init = { binary, dialect: region[navigator.language.split("-")[1]?.toUpperCase() ?? ""] ?? Dialect.American };
    const worker = new harper.WorkerLinter(init);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error("Harper's worker did not start")), 20000); });
    let engine: Linter = worker;
    try { await Promise.race([worker.setup(), late]); }
    catch (e) {
      console.warn(e);
      void worker.dispose();
      engine = new harper.LocalLinter(init);
      await engine.setup();
    } finally { clearTimeout(timer); }
    if (words.length) await engine.importWords(words);
    return engine;
  }).catch((error) => { linter = null; throw error; }));

// Batch arriving results so a long page is not redrawn for every checked paragraph.
function tell(text: string) {
  arrived.add(text);
  if (telling && waiting.size > 20) return;
  clearTimeout(telling);
  telling = setTimeout(() => {
    telling = undefined;
    const texts = arrived;
    arrived = new Set();
    listeners.forEach((listener) => listener(texts));
  }, waiting.size > 20 ? 1000 : 50);
}

async function check(text: string, version: number) {
  try {
    const groups = await (await start()).organizedLints(text, { language: "plaintext" });
    const mistakes: Mistake[] = [];
    for (const [rule, lints] of Object.entries(groups)) for (const lint of lints) {
      const span = lint.span();
      const suggestions = lint.suggestions();
      try {
        const original = text.slice(span.start, span.end);
        // Harper's public spans are UTF-16, matching ProseMirror even after emoji.
        if (original !== lint.get_problem_text()) continue;
        mistakes.push({ from: span.start, to: span.end, kind: lint.lint_kind(), rule,
          message: lint.message().replace(/`([^`]+)`/g, "“$1”"),
          suggestions: [...new Set(suggestions.map((s) => s.kind() === 2 ? original + s.get_replacement_text() : s.get_replacement_text()))],
        });
      } finally { suggestions.forEach((s) => s.free()); span.free(); lint.free(); }
    }
    if (version !== revision) return;
    if (found.size > 20000) found.clear();
    found.set(text, mistakes.sort((a, b) => a.from - b.from || a.to - b.to));
    errors.delete(text);
  } catch (error) {
    if (version !== revision) return;
    errors.set(text, error instanceof Error ? error.message : "The local checker could not finish.");
  } finally {
    if (waiting.get(text) === version) { waiting.delete(text); tell(text); }
  }
}

export function mistakesIn(text: string): Mistake[] | undefined {
  if (!text.trim() || errors.has(text)) return [];
  const known = found.get(text);
  if (known || waiting.has(text)) return known;
  waiting.set(text, revision);
  void check(text, revision);
  return undefined;
}

export const grammarError = (text: string) => errors.get(text) ?? null;
export const grammarWords = () => [...words];
export function onMistakes(listener: (texts: Set<string>) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function retryGrammarCheck() {
  const texts = new Set([...found.keys(), ...errors.keys(), ...waiting.keys()]);
  revision++;
  found.clear(); errors.clear(); waiting.clear();
  texts.forEach(tell);
}

let updatingWords: Promise<void> = Promise.resolve();
function changeWords(change: (current: string[]) => string[]) {
  const update = updatingWords.catch(() => {}).then(async () => {
    const next = change(words);
    const engine = await start();
    localStorage.setItem(WORDS_KEY, JSON.stringify(next));
    try { await engine.clearWords(); if (next.length) await engine.importWords(next); }
    catch (error) { localStorage.setItem(WORDS_KEY, JSON.stringify(words)); linter = null; throw error; }
    words = next;
    retryGrammarCheck();
  });
  updatingWords = update;
  return update;
}
export function addGrammarWord(word: string) {
  const clean = word.trim();
  if (!/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(clean)) return Promise.reject(new Error("Choose a single word to remember."));
  return changeWords((current) => [...new Set([...current, clean])]);
}
export const removeGrammarWord = (word: string) => changeWords((current) => current.filter((item) => item !== word));
