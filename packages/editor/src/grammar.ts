import type { Linter } from "harper.js";

// Grammar and spelling from Harper (Apache-2.0), on this Mac in a worker so typing never waits.
// Its binary is about 20 MB, so it loads the first time a check is asked for.
export type Mistake = { from: number; to: number; kind: string; message: string };
// Harper's kinds that are a word spelled wrong; the rest are grammar.
export const isSpelling = (kind: string) => kind === "Spelling" || kind === "Typo";

let linter: Promise<Linter> | null = null;
const found = new Map<string, Mistake[]>();
const waiting = new Set<string>();
const listeners = new Set<(texts: Set<string>) => void>();
let arrived = new Set<string>();
let telling: ReturnType<typeof setTimeout> | undefined;

const start = () =>
  (linter ??= Promise.all([import("harper.js"), import("harper.js/binary")]).then(async ([harper, { binary }]) => {
    const { Dialect } = harper;
    const region: Record<string, number> = { GB: Dialect.British, AU: Dialect.Australian, CA: Dialect.Canadian, IN: Dialect.Indian };
    const init = { binary, dialect: region[navigator.language.split("-")[1]?.toUpperCase() ?? ""] ?? Dialect.American };
    const worker = new harper.WorkerLinter(init);
    // A worker that can't start (a webview that won't load it) leaves Harper on the page itself.
    const late = new Promise<never>((_, fail) => setTimeout(() => fail(new Error("Harper's worker did not start")), 20000));
    try {
      await Promise.race([worker.setup(), late]);
      return worker;
    } catch (e) {
      console.warn(e);
      void worker.dispose();
      const local = new harper.LocalLinter(init);
      await local.setup();
      return local;
    }
  }));

// Results come back one text at a time; listeners hear of them together, and while a long page
// is first read only once a second, since each telling redraws and recounts the page.
function tell(text: string) {
  arrived.add(text);
  if (telling && waiting.size > 20) return;
  clearTimeout(telling);
  telling = setTimeout(
    () => {
      telling = undefined;
      const texts = arrived;
      arrived = new Set();
      listeners.forEach((l) => l(texts));
    },
    waiting.size > 20 ? 1000 : 50,
  );
}

async function check(text: string) {
  try {
    const lints = await (await start()).lint(text, { language: "plaintext" });
    // Long sessions write many versions of each line; old ones go.
    if (found.size > 20000) found.clear();
    found.set(
      text,
      lints.map((lint) => {
        const span = lint.span();
        // Harper writes words in backticks, as Markdown; the tooltip shows plain text.
        const message = lint.message().replace(/`([^`]+)`/g, "“$1”");
        const mistake = { from: span.start, to: span.end, kind: lint.lint_kind(), message };
        span.free();
        lint.free();
        return mistake;
      }),
    );
  } catch (e) {
    console.error(e);
    found.set(text, []);
  }
  waiting.delete(text);
  tell(text);
}

// The mistakes in a block's text, or undefined while Harper is still reading it.
export function mistakesIn(text: string): Mistake[] | undefined {
  if (!text.trim()) return [];
  const known = found.get(text);
  if (known || waiting.has(text)) return known;
  waiting.add(text);
  void check(text);
  return undefined;
}

export function onMistakes(listener: (texts: Set<string>) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
