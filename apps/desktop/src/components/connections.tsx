import type { EditorDoc } from "@leadinglight/editor/editor";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { aliasesOf } from "~/components/link-views";
import { RowIcon } from "~/components/page-icon";
import { useFront } from "~/lib/bar";
import { DAILY } from "~/lib/daily";
import { hasBlockLink, linesMentioning, linesSaying, linkFirst, linksIn } from "~/lib/doc-links";
import { pageLabel } from "~/lib/labels";
import { editPage, liveContent, liveProperties, watchLive } from "~/lib/live";
import { docText, type LLObject, type ObjectSummary, objects } from "~/lib/objects";
import { openBeside } from "~/lib/panes";
import { iconFor, pageOf, space, typeOf } from "~/lib/space";

// The bar's Connections (features/connections.feature): how the page in front sits in the space.

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v : []);
const isPerson = (p: ObjectSummary) => typeOf(p.typeId).id === "person";
const nameOf = (p: ObjectSummary) => (p.typeId === "tag" ? "#" : "") + pageLabel(p.title);

type Out = { page: ObjectSummary; body: boolean; via: string[] };
type In = { page: ObjectSummary; mentions: number; via: string[]; block: boolean };
type Share = { page: ObjectSummary; shared: string[] };

// The body and properties as the open editor holds them, read again once typing pauses or anything saves.
function useLive(id: string | undefined, saved: number) {
  const [now, setNow] = useState<{ id: string; doc: EditorDoc | null; values: Record<string, unknown> } | null>(null);
  useEffect(() => {
    if (!id) return;
    let on = true;
    const read = () => {
      const doc = liveContent(id);
      const values = liveProperties(id) ?? pageOf(id)?.properties ?? {};
      if (doc) return setNow({ id, doc, values });
      void objects.get(id).then((o) => on && setNow({ id, doc: o?.content ?? null, values }));
    };
    read();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchLive(id, () => {
      clearTimeout(timer);
      timer = setTimeout(read, 300);
    });
    return () => {
      on = false;
      clearTimeout(timer);
      stop();
    };
  }, [id, saved]);
  return now?.id === id ? now : null;
}

export function Connections() {
  const front = useFront();
  const { pages, props, saved } = space.use();
  const page = front ? pageOf(front) : undefined;
  const id = page?.id;
  const live = useLive(id, saved);
  const [lit, setLit] = useState<string | null>(null);
  // Kept with the page they were found for, so another page never shows them.
  const [found, setFound] = useState<{ id: string; incoming: In[]; shares: Share[] } | null>(null);
  const relations = useMemo(() => props.filter((p) => p.kind === "relation"), [props]);

  // What this page links: in its body first, in order, then through its relation properties.
  const outgoing = useMemo(() => {
    const out = new Map<string, Out>();
    for (const x of linksIn(live?.doc ?? null)) {
      const p = x !== id && pageOf(x);
      if (p) out.set(x, { page: p, body: true, via: [] });
    }
    for (const r of relations)
      for (const x of asIds(live?.values[r.id])) {
        const p = x !== id && pageOf(x);
        if (p) out.set(x, { ...(out.get(x) ?? { page: p, body: false, via: [] }), via: [...(out.get(x)?.via ?? []), r.name] });
      }
    return [...out.values()];
  }, [live, relations, pages, id]);
  const outKey = outgoing.map((o) => o.page.id).join(",");

  // Linked here is Backlinks' search; Shares with asks the same of each page this one links.
  useEffect(() => {
    if (!id) return;
    let on = true;
    const linksTo = (o: LLObject, x: string) => linesMentioning(o.content, x).length > 0 || hasBlockLink(o.content, x) || relations.some((r) => asIds(o.properties[r.id]).includes(x));
    // Saves come in bursts while typing; look again once they settle. Sixteen links are enough to rank by.
    const timer = setTimeout(async () => {
      const outs = outKey ? outKey.split(",").slice(0, 16) : [];
      const [here, ...linking] = await Promise.all([objects.containing(id), ...outs.map((x) => objects.containing(x))]);
      if (!on) return;
      const incoming = here
        .filter((o) => o.id !== id && !o.properties.templateOf)
        .map((o) => ({ page: o, mentions: linesMentioning(o.content, id).length, via: relations.filter((r) => asIds(o.properties[r.id]).includes(id)).map((r) => r.name), block: hasBlockLink(o.content, id) }))
        .filter((s) => s.mentions || s.via.length || s.block);
      const near = new Set([id, ...outKey.split(","), ...incoming.map((s) => s.page.id)]);
      const overlap = new Map<string, { page: LLObject; shared: string[] }>();
      outs.forEach((x, i) => {
        for (const o of linking[i]) {
          if (near.has(o.id) || o.properties.templateOf || !linksTo(o, x)) continue;
          const s = overlap.get(o.id) ?? { page: o, shared: [] };
          overlap.set(o.id, { ...s, shared: [...s.shared, x] });
        }
      });
      const shares = [...overlap.values()]
        .filter((s) => s.shared.length >= 2)
        .sort((a, b) => b.shared.length - a.shared.length || b.page.updatedAt - a.page.updatedAt)
        .map((s) => ({ page: s.page, shared: s.shared.map((x) => nameOf(pageOf(x) ?? s.page)) }));
      setFound({ id, incoming, shares });
    }, 300);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [id, outKey, saved, relations]);

  // Titles and aliases said in the text without a link, first said first.
  const unlinked = useMemo(() => {
    const doc = live?.doc;
    if (!doc || !id) return [];
    const text = docText(doc).toLowerCase();
    const linked = new Set(outKey.split(","));
    const found: { page: ObjectSummary; words: string; at: number }[] = [];
    for (const p of pages) {
      if (p.id === id || linked.has(p.id) || p.typeId === "tag" || p.typeId === DAILY || p.properties.templateOf) continue;
      for (const words of [p.title.trim(), ...aliasesOf(p)]) {
        const at = words.length >= 3 ? text.indexOf(words.toLowerCase()) : -1;
        if (at < 0 || !linesSaying(doc, words).length) continue;
        found.push({ page: p, words, at });
        break;
      }
    }
    return found.sort((a, b) => a.at - b.at);
  }, [live, pages, id, outKey]);

  if (!page || !id) return <p className="m-auto px-6 py-10 text-center text-muted-foreground text-sm">Open a page to see what it connects to.</p>;

  const { incoming, shares } = found?.id === id ? found : { incoming: [], shares: [] };
  const fresh = (p: ObjectSummary) => pageOf(p.id) ?? p;
  const links = outgoing.filter((o) => !isPerson(o.page));
  const here = incoming.filter((s) => pageOf(s.page.id) && !isPerson(fresh(s.page)));
  // People: mentioned, named by a property, or linking here.
  const people = new Map<string, { page: ObjectSummary; how: string[] }>();
  for (const o of outgoing.filter((o) => isPerson(o.page))) people.set(o.page.id, { page: o.page, how: [...(o.body ? ["Mentioned"] : []), ...o.via] });
  for (const s of incoming.filter((s) => pageOf(s.page.id) && isPerson(fresh(s.page)))) {
    const had = people.get(s.page.id) ?? { page: fresh(s.page), how: [] };
    people.set(s.page.id, { ...had, how: [...had.how, s.via.length ? `Through ${s.via.join(", ")}` : "Links here"] });
  }
  const nodes = [...new Map([...links.map((o) => o.page), ...[...people.values()].map((p) => p.page), ...here.map((s) => fresh(s.page))].map((p) => [p.id, p] as const)).values()];
  const empty = !nodes.length && !shares.length && !unlinked.length;
  const row = (p: ObjectSummary, meta: string, action?: ReactNode) => <Row action={action} key={p.id} lit={lit === p.id} meta={meta} onLight={setLit} page={fresh(p)} />;
  const typeName = (p: ObjectSummary) => typeOf(p.typeId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" data-connections>
      {/* In the rows' gutter, labels included. */}
      <div className="px-2.5">
        <ConnectionMap centre={pageLabel(page.title)} lit={lit} nodes={nodes} onLight={setLit} />
      </div>
      {empty ? (
        <p className="px-6 py-4 text-center text-muted-foreground text-sm">Nothing linked yet. Type @ in the page to link something.</p>
      ) : (
        <>
          <Section n={links.length} title="Links from this page">
            {links.map((o) => {
              const t = typeName(o.page);
              return row(o.page, [t.name, ...o.via.filter((v) => v !== t.name && v !== t.plural)].join(" · "));
            })}
          </Section>
          <Section n={here.length} title="Linked here">
            {here.map((s) => row(s.page, [typeName(fresh(s.page)).name, s.via.length ? `Through ${s.via.join(", ")}` : s.mentions ? `${s.mentions} ${s.mentions === 1 ? "mention" : "mentions"}` : "On its own line"].join(" · ")))}
          </Section>
          <Section n={shares.length} title="Shares with">
            {shares.map((s) => row(s.page, s.shared.join(", ")))}
          </Section>
          <Section n={people.size} title="People">
            {[...people.values()].map((p) => row(p.page, p.how.join(", ")))}
          </Section>
          <Section n={unlinked.length} title="Not linked yet">
            {unlinked.map((u) =>
              row(
                u.page,
                u.words === u.page.title.trim() ? typeName(u.page).name : `“${u.words}”`,
                <Button className="me-2.5 shrink-0" onClick={() => void editPage(id, { content: (doc) => linkFirst(doc, u.words, u.page.id) })} size="xs" variant="outline">
                  Link
                </Button>,
              ),
            )}
          </Section>
        </>
      )}
    </div>
  );
}

// The page in front, beside the panel's name.
export function FrontTitle() {
  const front = useFront();
  space.use();
  const page = front ? pageOf(front) : undefined;
  return page ? <span className="ms-2 min-w-0 flex-[1_1_0] truncate text-muted-foreground text-sm">{pageLabel(page.title)}</span> : null;
}

function Section({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  if (!n) return null;
  return (
    <section aria-label={title} className="mt-2">
      <h3 className="flex h-7 items-center px-2.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {title} · {n}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

// The Feed's row: icon, title, a muted line; it opens the page beside.
function Row({ page, meta, lit, onLight, action }: { page: ObjectSummary; meta: string; lit: boolean; onLight: (id: string | null) => void; action?: ReactNode }) {
  return (
    <li className={cn("flex items-center rounded-lg transition-colors duration-150 ease-out hover:bg-accent/40", lit && "bg-accent/40")} data-lit={lit || undefined} data-row={page.id} onPointerEnter={() => onLight(page.id)} onPointerLeave={() => onLight(null)}>
      <button className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left focus-visible:bg-accent/60" onClick={() => openBeside(page.id)} type="button">
        <span className="mt-0.5 flex shrink-0">
          <RowIcon icon={iconFor(page)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-snug">{pageLabel(page.title)}</span>
          {meta && <span className="mt-0.5 block truncate text-muted-foreground text-xs">{meta}</span>}
        </span>
      </button>
      {action}
    </li>
  );
}

const H = 180;
const CAP = 16;
const CHAR = 6; // about one 11 px letter: enough to keep labels apart
const cut = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] + 2 && b[0] < a[2] + 2 && a[1] < b[3] + 2 && b[1] < a[3] + 2;

// The page in the middle, its neighbours on a ring. A label that would cover another shows on hover.
function ConnectionMap({ centre, nodes, lit, onLight }: { centre: string; nodes: ObjectSummary[]; lit: string | null; onLight: (id: string | null) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = nodes.slice(0, CAP);
  const cx = w / 2;
  const cy = H / 2;
  const label = (text: string, x: number, y: number) => {
    const half = (text.length * CHAR) / 2;
    const at = Math.min(w - half, Math.max(half, x));
    return { x: at, y, box: [at - half, y - 10, at + half, y + 3] as Box };
  };
  const middle = label(cut(centre), cx, cy + 19);
  const ring = shown.map((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length;
    return { p, a, x: cx + (w / 2 - 16) * Math.cos(a), y: cy + (H / 2 - 24) * Math.sin(a) };
  });
  // Labels keep off each other and off every other node.
  const dot = (x: number, y: number): Box => [x - 5, y - 5, x + 5, y + 5];
  const taken: Box[] = [middle.box, dot(cx, cy), ...(nodes.length > CAP ? [[w - 64, H - 14, w, H] as Box] : [])];
  const placed = ring.map(({ p, a, x, y }) => {
    const text = cut(nameOf(p));
    const half = (text.length * CHAR) / 2;
    const up = Math.sin(a) <= 0.25;
    // Outside the ring first, then the other side, then beside the node facing the middle.
    const spots = [up ? y - 9 : y + 16, up ? y + 16 : y - 9].map((ly) => label(text, x, ly));
    spots.push(label(text, Math.cos(a) > 0 ? x - 9 - half : x + 9 + half, y + 4));
    const others = ring.filter((o) => o.p !== p).map((o) => dot(o.x, o.y));
    const fit = spots.find((s) => ![...taken, ...others].some((b) => overlaps(b, s.box)));
    if (fit) taken.push(fit.box);
    return { p, x, y, l: fit ?? spots[0], free: !!fit, text };
  });
  const halo = { paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3, strokeLinejoin: "round" } as const;
  return (
    <svg aria-label={`${centre} and ${nodes.length} connected pages`} className="block h-[180px] w-full text-[11px] text-foreground" ref={ref} role="img">
      {w > 0 && (
        <>
          {placed.map(({ p, x, y }) => (
            <line className="transition-[stroke] duration-150 ease-out" key={p.id} stroke={lit === p.id ? "var(--muted-foreground)" : "var(--border)"} x1={cx} x2={x} y1={cy} y2={y} />
          ))}
          <circle cx={cx} cy={cy} fill="currentColor" r={5} />
          <text className="font-medium" fill="currentColor" style={halo} textAnchor="middle" x={middle.x} y={middle.y}>
            {cut(centre)}
          </text>
          {placed.map(({ p, x, y, l, free, text }) => {
            const on = lit === p.id;
            return (
              <g className="cursor-pointer" data-node={p.id} key={p.id} onClick={() => openBeside(p.id)} onPointerEnter={() => onLight(p.id)} onPointerLeave={() => onLight(null)}>
                <circle cx={x} cy={y} fill="transparent" r={11} />
                <circle className="transition-[fill] duration-150 ease-out" cx={x} cy={y} fill={on ? "currentColor" : "var(--muted-foreground)"} r={5} />
                {free && (
                  <text className="transition-[fill] duration-150 ease-out" fill={on ? "currentColor" : "var(--muted-foreground)"} style={halo} textAnchor="middle" x={l.x} y={l.y}>
                    {text}
                  </text>
                )}
              </g>
            );
          })}
          {/* A hidden label shows over the rest while its node or row is hovered. */}
          {placed
            .filter(({ p, free }) => !free && lit === p.id)
            .map(({ p, l, text }) => (
              <text className="pointer-events-none" fill="currentColor" key={p.id} style={halo} textAnchor="middle" x={l.x} y={l.y}>
                {text}
              </text>
            ))}
          {nodes.length > CAP && (
            <text fill="var(--muted-foreground)" textAnchor="end" x={w - 2} y={H - 4}>
              +{nodes.length - CAP} more
            </text>
          )}
        </>
      )}
    </svg>
  );
}
