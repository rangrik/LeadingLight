import type { EditorDoc, NotesStore } from "@leadinglight/editor/editor";
import { Button } from "@leadinglight/ui/components/button";
import { Card, CardPanel } from "@leadinglight/ui/components/card";
import { Input } from "@leadinglight/ui/components/input";
import { Kbd } from "@leadinglight/ui/components/kbd";
import { MessageSquareDashed } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Row } from "~/components/work-panel";
import { openEssay } from "~/lib/essay";
import { liveContent, liveEditor } from "~/lib/live";
import { docText } from "~/lib/objects";
import { anchored, closeRecall, keepRecalled, type Noted, notedIn, recalling, unanchored } from "~/lib/recall";
import { quietly } from "~/lib/tail";

// Recall's card (features/recall.feature): under the properties, above the body, one noted thing at
// a time. A line typed becomes a thought on the same words; Back can change it or take it back.
export function RecallCard({ page, notes }: { page: string; notes?: NotesStore }) {
  const open = recalling.use().includes(page);
  return open && notes ? <Round notes={notes} page={page} /> : null;
}

const para = (text: string): EditorDoc[] => [{ type: "paragraph", content: [{ type: "text", text }] }];

function Round({ page, notes }: { page: string; notes: NotesStore }) {
  // The noted things as the card opened, a note read as its thought's words.
  const [items] = useState(() => notedIn(liveContent(page), (id) => !!notes.read(id)).map((n): Noted => (n.note ? { ...n, text: docText({ type: "doc", content: notes.read(n.note) }) } : n)));
  const [at, setAt] = useState(0);
  const [lines, setLines] = useState<Record<string, string>>({});
  // Per noted thing: the thought its line made and its words, and when Next passed it.
  const made = useRef<Record<string, { id: string; line: string }>>({});
  const passed = useRef<Record<string, number>>({});
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const item = items[at] as Noted | undefined;

  useLayoutEffect(() => (item ? input.current : root.current)?.focus({ preventScroll: true }), [item]);

  // The body takes the new note's mark as the app's edit, not the person's typing (lib/tail.ts).
  const edit = (change: (doc: EditorDoc) => { block: number; next: EditorDoc } | null) => {
    const ed = liveEditor(page);
    const to = ed && change(ed.getJSON());
    if (ed && to) quietly(() => ed.setBlock(to.block, to.next));
  };
  // A changed line replaces its note, since the margin redraws a note only when it is new.
  const keep = (it: Noted) => {
    const line = (lines[it.key] ?? "").trim();
    const had = made.current[it.key];
    passed.current[it.key] = Date.now();
    if (had?.line === line) return;
    if (had) {
      edit((doc) => unanchored(doc, had.id));
      notes.remove(had.id);
      delete made.current[it.key];
    }
    if (!line) return;
    const id = crypto.randomUUID().slice(0, 8);
    notes.add(id, it.quote);
    notes.write(id, para(line));
    made.current[it.key] = { id, line };
    edit((doc) => anchored(doc, it, id));
  };
  const close = async (then?: () => unknown) => {
    // A line typed and not yet kept is kept, never lost.
    if (item && ((lines[item.key] ?? "").trim() || made.current[item.key])) keep(item);
    closeRecall(page);
    const kept = items.filter((i) => passed.current[i.key]).map((i) => (i.note ? { thought: i.note, at: passed.current[i.key] } : { quote: i.quote, at: passed.current[i.key] }));
    await keepRecalled(page, kept, Object.keys(made.current).length > 0);
    await then?.();
  };
  const next = () => {
    if (item) keep(item);
    setAt(at + 1);
  };

  return (
    <Card
      className="mt-4 animate-[ll-fade-in_150ms_ease-out] outline-none"
      data-testid="recall"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          void close();
        } else if (e.key === "Enter" && (e.target === input.current || (!item && e.target === root.current))) {
          e.preventDefault();
          if (item) next();
          else void close();
        }
      }}
      ref={root}
      tabIndex={-1}
    >
      <CardPanel className="flex flex-col gap-3 p-4">
        {item ? (
          <>
            <Row className="text-muted-foreground text-sm">
              <MessageSquareDashed className="size-4 shrink-0" />
              {at + 1} of {items.length}
            </Row>
            <div>
              <p className="whitespace-pre-wrap text-base leading-[1.6]">{item.text}</p>
              {item.note && <p className="mt-1 text-muted-foreground text-sm">“{item.quote}”</p>}
            </div>
            <Input aria-label="In your own words" onChange={(e) => setLines({ ...lines, [item.key]: e.currentTarget.value })} placeholder="In your own words" ref={input} value={lines[item.key] ?? ""} />
            <div className="flex items-center gap-1">
              <Button disabled={at === 0} onClick={() => setAt(at - 1)} size="sm" variant="ghost">
                Back
              </Button>
              <span className="ms-auto flex items-center gap-1">
                <Button onClick={next} size="sm" variant="outline">
                  Next <Kbd>↩</Kbd>
                </Button>
                <Button onClick={() => void close()} size="sm" variant="ghost">
                  Done <Kbd>esc</Kbd>
                </Button>
              </span>
            </div>
          </>
        ) : (
          <Row className="text-sm">
            <MessageSquareDashed className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {Object.keys(passed.current).length} of {items.length} recalled.
            </span>
            <Button onClick={() => void close(() => openEssay(page))} size="xs" variant="outline">
              Write it up
            </Button>
            <Button onClick={() => void close()} size="xs" variant="ghost">
              Done
            </Button>
          </Row>
        )}
      </CardPanel>
    </Card>
  );
}
