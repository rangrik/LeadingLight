import { BlockEditor, type BlockEditorHandle, type EditorDoc } from "@leadinglight/editor/editor";
import { Link2, PenLine, Plus } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Badge } from "@leadinglight/ui/components/badge";
import { Button } from "@leadinglight/ui/components/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@leadinglight/ui/components/tooltip";
import { linkHost } from "~/components/link-views";
import { assets } from "~/lib/assets";
import { firstLineText, linesSaying, linkFirst } from "~/lib/doc-links";
import { openEssay, openHref } from "~/lib/essay";
import { pageLabel } from "~/lib/labels";
import { childOf } from "~/lib/linked";
import { editPage, liveContent, watchLive, whenLive } from "~/lib/live";
import { docText, type ObjectSummary } from "~/lib/objects";
import { createPage, pageOf, space, typeOf } from "~/lib/space";
import { useThoughts } from "~/lib/thoughts";

// The Your words column beside a source (features/reading-layout.feature): its sidenotes, the
// reader's takeaways, names in the text worth a page, and the essay it could become.

// Narrower panes fold the column into tabs above the body.
const FOLD = 1100;

// The pane's size while the page is a source: the column folds under FOLD, and stays within the
// pane's height as the page scrolls.
export function usePane(root: RefObject<HTMLElement | null>, on: boolean) {
  // Unmeasured counts as wide, so a page opening wide doesn't first draw narrow and widen.
  const [size, setSize] = useState({ width: Infinity, height: 0 });
  useLayoutEffect(() => {
    const el = root.current?.closest<HTMLElement>("[data-page-scroller]") ?? root.current;
    if (!on || !el) return;
    // A tab behind measures 0; it keeps its last size until it shows.
    const read = () => void (el.clientWidth && setSize({ width: el.clientWidth, height: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root, on]);
  return { wide: size.width >= FOLD, height: size.height };
}

// The page's body a moment after each edit: reading it on every key would slow a long page.
function useBody(id: string) {
  const [doc, setDoc] = useState<EditorDoc | null>(() => liveContent(id) ?? null);
  const read = useCallback(() => setDoc(liveContent(id) ?? null), [id]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    whenLive(id, read);
    const off = watchLive(id, () => {
      clearTimeout(timer);
      timer = setTimeout(read, 400);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [id, read]);
  return [doc, read] as const;
}

// Each sidenote in reading order, with the words it is on.
function notesIn(doc: EditorDoc | null) {
  const found = new Map<string, string>();
  const walk = (n: EditorDoc) => {
    for (const m of n.marks ?? []) if (m.type === "note" && m.attrs?.id) found.set(m.attrs.id, (found.get(m.attrs.id) ?? "") + (n.text ?? ""));
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return [...found].map(([id, words]) => ({ id, words }));
}

type Concept = { words: string; page?: string };

const namesOf = (p: ObjectSummary) => [p.title, ...(typeof p.properties.aliases === "string" ? p.properties.aliases.split(",") : [])].map((n) => n.trim()).filter(Boolean);
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u);

// Pages the text names without linking (by title or alias, three letters or more), then the five
// capitalised words said most often, twice or more and once mid-sentence, that aren't a page.
function conceptsIn(doc: EditorDoc | null, self: { id: string; title: string }, pages: ObjectSummary[]): Concept[] {
  if (!doc) return [];
  const text = docText(doc);
  const lower = text.toLowerCase();
  const linked = new Set<string>();
  const walk = (n: EditorDoc) => {
    if ((n.type === "mention" || n.type === "pageLink") && n.attrs?.id) linked.add(n.attrs.id);
    n.content?.forEach(walk);
  };
  walk(doc);
  const named = pages
    .filter((p) => p.id !== self.id && !linked.has(p.id) && !p.properties.parent && !p.properties.templateOf && p.typeId !== "tag" && p.typeId !== "daily" && !typeOf(p.typeId).made)
    .flatMap((p) => {
      const words = namesOf(p).find((n) => n.length >= 3 && lower.includes(n.toLowerCase()) && linesSaying(doc, n).length);
      return words ? [{ words, page: p.id, at: lower.indexOf(words.toLowerCase()) }] : [];
    })
    .sort((a, b) => a.at - b.at);

  const said = new Map<string, { n: number; mid: boolean; at: number }>();
  let offset = 0;
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}]+/gu)) {
      const before = line.slice(0, m.index).trimEnd();
      const was = said.get(m[0]) ?? { n: 0, mid: false, at: offset + m.index };
      said.set(m[0], { n: was.n + 1, mid: was.mid || !(before === "" || /[.!?:;"“(—–-]$/.test(before)), at: was.at });
    }
    offset += line.length + 1;
  }
  const pageNames = new Set(pages.flatMap(namesOf).map((n) => n.toLowerCase()));
  const taken = new Set(wordsOf([self.title, ...named.map((c) => c.words)].join(" ")));
  const common = [...said]
    .filter(([w, s]) => s.n >= 2 && s.mid && !pageNames.has(w.toLowerCase()) && !taken.has(w.toLowerCase()))
    .sort((a, b) => b[1].n - a[1].n || a[1].at - b[1].at)
    .slice(0, 5)
    .map(([words]) => ({ words }));
  return [...named.map(({ words, page }) => ({ words, page })), ...common];
}

const isBlank = (doc: EditorDoc | null) => !doc?.content?.length || (doc.content.length === 1 && doc.content[0].type === "paragraph" && !doc.content[0].content?.length);
const titleOf = (id: string) => pageLabel(pageOf(id)?.title ?? "");

const Heading = ({ children }: { children: React.ReactNode }) => <h2 className="flex h-7 items-center font-medium text-muted-foreground">{children}</h2>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-muted-foreground">{children}</p>;

export function YourWords({
  page,
  editor,
  quotes,
  takeaways,
  onTakeaways,
  reveal,
}: {
  page: ObjectSummary;
  editor: RefObject<BlockEditorHandle | null>;
  quotes: number;
  takeaways: EditorDoc | null;
  onTakeaways: (doc: EditorDoc) => void;
  reveal: (note: string) => void;
}) {
  const [body, reread] = useBody(page.id);
  // A listener of its own on the Thoughts page, so a note typed beside the text shows here at once.
  const thoughts = useThoughts(page, () => {});
  const { pages } = space.use();
  const notes = useMemo(() => notesIn(body), [body]);
  const concepts = useMemo(() => conceptsIn(body, { id: page.id, title: page.title }, pages), [body, page.id, page.title, pages]);
  const [missed, setMissed] = useState(false);
  const [blank, setBlank] = useState(() => isBlank(takeaways));
  const essay = childOf(page, "essay");

  useEffect(() => {
    if (!missed) return;
    const t = setTimeout(() => setMissed(false), 3000);
    return () => clearTimeout(t);
  }, [missed]);

  const act = async (c: Concept) => {
    const target = c.page ?? (await createPage({ title: c.words })).id;
    await editPage(page.id, { content: (doc) => linkFirst(doc, c.words, target) });
    reread();
  };

  return (
    <div className="ll-your-words flex flex-col gap-6 text-sm">
      <div aria-label="Notes" role="group">
        <div className="flex items-center justify-between">
          <Heading>Notes</Heading>
          {/* Keeps the keyboard in the page, so its selection is what gets the note. */}
          <Button className="-me-2 text-muted-foreground" onClick={() => editor.current?.addNote() || setMissed(true)} onMouseDown={(e) => e.preventDefault()} size="xs" variant="ghost">
            <Plus />
            Add note
          </Button>
        </div>
        {missed && <Empty>Select words in the page first.</Empty>}
        {notes.length ? (
          <div className="-mx-2 flex flex-col">
            {notes.map((n, i) => {
              const line = firstLineText({ type: "doc", content: thoughts?.read(n.id) ?? [] }, titleOf);
              return (
                <button className="flex min-w-0 items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-accent" key={n.id} onClick={() => reveal(n.id)} type="button">
                  <span className="shrink-0 font-semibold tabular-nums">{i + 1}</span>
                  <span className={line ? "truncate" : "truncate text-muted-foreground"}>{line || `“${n.words.trim()}”`}</span>
                </button>
              );
            })}
          </div>
        ) : (
          !missed && <Empty>No notes yet. Select words and press ⇧⌘M.</Empty>
        )}
      </div>

      <div aria-label="Takeaways" role="group">
        <Heading>Takeaways</Heading>
        <div className="ll-takeaways" data-empty={blank || undefined}>
          <BlockEditor
            assets={assets}
            content={takeaways}
            label="Takeaways"
            links={linkHost}
            onChange={(read) => {
              const doc = read();
              setBlank(isBlank(doc));
              onTakeaways(doc);
            }}
            openLink={openHref}
            placeholder="In your own words…"
          />
        </div>
      </div>

      <div aria-label="Concepts" role="group">
        <Heading>Concepts</Heading>
        {concepts.length ? (
          <div className="flex flex-wrap gap-1.5">
            {concepts.map((c) => (
              <Tooltip key={c.words}>
                <TooltipTrigger render={<Badge onClick={() => void act(c)} render={<button type="button" />} size="lg" variant="outline" />}>
                  {c.page ? <Link2 /> : <Plus />}
                  {c.words}
                </TooltipTrigger>
                <TooltipPopup>{c.page ? `Link the first “${c.words}” to ${titleOf(c.page)}` : `Make a page “${c.words}” and link its first mention`}</TooltipPopup>
              </Tooltip>
            ))}
          </div>
        ) : (
          <Empty>Nothing to link yet.</Empty>
        )}
      </div>

      <div aria-label="Write it up" role="group">
        <Heading>Write it up</Heading>
        <Button className="-ms-2 text-muted-foreground" onClick={() => void (essay ? openHref(`ll:${essay}`) : openEssay(page.id))} size="sm" variant="ghost">
          <PenLine />
          Essay · {quotes} {quotes === 1 ? "quote" : "quotes"}
        </Button>
      </div>
    </div>
  );
}
