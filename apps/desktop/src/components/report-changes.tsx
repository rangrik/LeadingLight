import { preloadHighlighter } from "@pierre/diffs";
import { MultiFileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import { useDark } from "@/components/diff/load";
import { liveContent } from "~/lib/live";
import { objects } from "~/lib/objects";
import { docMarkdown } from "~/lib/page-markdown";
import { pageOf } from "~/lib/space";

// What changed between two reports by one agent (features/review-mode.feature), drawn by
// @pierre/diffs as prose: every block a line, word changes marked, in the page's font and colours.

// The library draws in a shadow root; the app's tokens reach it as inherited variables.
const CSS = `
:host {
  --diffs-font-family: -apple-system, BlinkMacSystemFont, "Inter Variable", sans-serif;
  --diffs-font-size: 1rem;
  --diffs-line-height: 1.6;
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-light: var(--foreground);
  --diffs-dark: var(--foreground);
  --diffs-addition-color-override: var(--success);
  --diffs-deletion-color-override: var(--destructive);
  --diffs-modified-color-override: var(--info);
  --diffs-bg-separator-override: var(--muted);
  --diffs-bg-addition-override: color-mix(in srgb, var(--success) 8%, var(--background));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--success) 24%, var(--background));
  --diffs-bg-deletion-override: color-mix(in srgb, var(--destructive) 6%, var(--background));
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--destructive) 20%, var(--background));
}
[data-line] span { color: var(--foreground) !important; }
/* What was taken out reads as gone: muted and struck through. */
[data-line-type=change-deletion] { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--destructive) 60%, transparent); }
[data-line-type=change-deletion] span { color: var(--muted-foreground) !important; }
[data-separator] { font-size: 0.8125rem; color: var(--muted-foreground); }
`;

const OPTIONS = {
  theme: { light: "pierre-light", dark: "pierre-dark" },
  diffStyle: "unified",
  overflow: "wrap",
  disableFileHeader: true,
  disableLineNumbers: true,
  diffIndicators: "bars",
  lineDiffType: "word",
  expandUnchanged: true,
  unsafeCSS: CSS,
} as const;

// A report's words as lines: Markdown's block marks kept, its emphasis marks taken off.
async function textOf(id: string) {
  const doc = liveContent(id) ?? (await objects.get(id))?.content ?? null;
  return `${docMarkdown(doc, (p) => pageOf(p)?.title ?? "").replace(/\*\*|~~|`/g, "")}\n`;
}

// Loaded while the report is read, so turning Changes on shows them at once.
export const warm = () => preloadHighlighter({ themes: [OPTIONS.theme.light, OPTIONS.theme.dark], langs: ["text"] });

export default function ReportChanges({ before, after }: { before: string; after: string }) {
  const dark = useDark();
  const [texts, setTexts] = useState<[string, string] | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([textOf(before), textOf(after)]).then((t) => live && setTexts(t), console.error);
    return () => void (live = false);
  }, [before, after]);
  const options = useMemo(() => ({ ...OPTIONS, themeType: dark ? ("dark" as const) : ("light" as const) }), [dark]);
  if (!texts) return null;
  return (
    // Its change bars sit in the handle's gutter, so its words line up with the title's.
    <div className="-ms-4 pt-2" data-testid="report-changes">
      <MultiFileDiff newFile={{ name: "report.txt", contents: texts[1], cacheKey: `${after}-b` }} oldFile={{ name: "report.txt", contents: texts[0], cacheKey: `${before}-a` }} options={options} />
    </div>
  );
}
