import type { EditorDoc } from "@leadinglight/editor/editor";
import { useEffect, useMemo, useState } from "react";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { armDrag } from "~/components/pane-drag";
import { type Found, type Span, textSearch, wordsOf } from "~/lib/filter";
import { pageLabel } from "~/lib/labels";
import { docText, objects } from "~/lib/objects";
import { iconFor, pageOf, space } from "~/lib/space";

// Text with the spans in bold: a filtered title, or a found line.
export function Marked({ text, spans }: { text: string; spans: Span[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (from < at) continue;
    parts.push(text.slice(at, from), <strong className="font-semibold" key={from}>{text.slice(from, to)}</strong>);
    at = to;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

// Mentions read as the titles they show, so a found line reads as the page does.
const titled = (node: EditorDoc): EditorDoc => {
  if (node.type !== "mention") return node.content ? { ...node, content: node.content.map(titled) } : node;
  const p = pageOf(String(node.attrs?.id ?? ""));
  return { type: "text", text: p ? `${node.attrs?.tag ? "#" : ""}${pageLabel(p.title)}` : "" };
};
const search = textSearch(async (id) => {
  const doc = (await objects.get(id))?.content;
  return docText(doc ? titled(doc) : null);
});

// The pane opened by the sidebar's "Search in page text" row: pages whose body has every word.
export function TextResults({ query }: { query: string }) {
  const { pages } = space.use();
  const words = useMemo(() => wordsOf(query), [query]);
  const [found, setFound] = useState<Found[] | null>(null);
  useEffect(() => {
    let stale = false;
    search(words, pages.filter((p) => !p.properties.templateOf)).then((f) => !stale && setFound(f), console.error);
    return () => {
      stale = true;
    };
  }, [words, pages]);
  const count = found && (found.length === 1 ? "1 page" : `${found.length} pages`);
  return (
    <div className="w-full max-w-[1000px] ps-6 pe-6 pt-10 pb-48 @sm:ps-16 @xl:pe-16">
      <h1 className="font-bold font-heading text-[36px] leading-[1.2] tracking-tight">“{query.trim()}”</h1>
      <p className="mt-2 text-muted-foreground text-sm">{found === null ? "Searching page text…" : found.length ? `${count} with these words` : "No page has these words in its text."}</p>
      {/* Rows as the type list's, with the found line under the title. */}
      <div className="-mx-2 mt-6 flex flex-col text-sm">
        {found?.map(({ page, line, spans }) => (
          <div
            className="flex cursor-default flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-accent"
            key={page.id}
            onClick={(e) => visit(page.id, e)}
            onKeyDown={(e) => e.key === "Enter" && visit(page.id, e as unknown as React.MouseEvent)}
            onPointerDown={(e) => armDrag(e, { page: page.id, label: pageLabel(page.title) })}
            role="link"
            tabIndex={0}
          >
            <span className="flex min-w-0 items-center gap-2">
              <RowIcon icon={iconFor(page)} />
              <span className="truncate">{pageLabel(page.title)}</span>
            </span>
            <span className="truncate ps-6 text-muted-foreground [&_strong]:text-foreground">
              <Marked spans={spans} text={line} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
