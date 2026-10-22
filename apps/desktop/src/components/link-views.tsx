import { BlockEditor } from "@leadinglight/editor/editor";
import type { LinkHost, LinkItem } from "@leadinglight/editor/links";
import { CalendarDays, LayoutPanelTop, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Card } from "@leadinglight/ui/components/card";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@leadinglight/ui/components/menu";
import { cn } from "@leadinglight/ui/lib/utils";
import { PageIconView, RowIcon } from "@/components/page-icon";
import { ValueView, visit } from "@/components/property-value";
import { LINK_VIEWS } from "@/components/type-view";
import { assets } from "@/lib/assets";
import type { LinkView } from "@/lib/catalog";
import { dailyTitle, ensureDaily, shiftDay, today } from "@/lib/daily";
import { pageLabel } from "@/lib/labels";
import { openLink } from "@/lib/links";
import { type LLObject, type ObjectSummary, objects } from "@/lib/objects";
import { COLORS, readCover } from "@/lib/page-meta";
import { focusedPage } from "@/lib/panes";
import { createPage, iconFor, pageOf, propOf, space, typeOf } from "@/lib/space";
import { PAGE_TYPE } from "@/lib/store";

const aliasesOf = (p: ObjectSummary) =>
  String(p.properties.aliases ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

// What "@", "[[" and "#" offer: matching pages (by title or alias), days, and a new page.
function search(query: string, tag: boolean): LinkItem[] {
  const q = query.trim().toLowerCase();
  const here = focusedPage();
  const pool = space.get().pages.filter((p) => p.id !== here && !p.properties.templateOf && (p.typeId === "tag") === tag);
  const alias = (p: ObjectSummary) => aliasesOf(p).find((a) => a.toLowerCase().includes(q));
  const found = pool
    .filter((p) => !q || pageLabel(p.title).toLowerCase().includes(q) || alias(p))
    .sort((a, b) => Number(!pageLabel(a.title).toLowerCase().startsWith(q)) - Number(!pageLabel(b.title).toLowerCase().startsWith(q)) || b.updatedAt - a.updatedAt)
    .slice(0, 8);
  const items: LinkItem[] = found.map((p) => ({
    key: p.id,
    title: pageLabel(p.title),
    icon: <RowIcon icon={iconFor(p)} />,
    hint: q && alias(p) && !pageLabel(p.title).toLowerCase().includes(q) ? alias(p) : typeOf(p.typeId).name,
    link: async () => p.id,
  }));
  if (!tag) {
    const days: [string, string][] = [
      ["Today", today()],
      ["Tomorrow", shiftDay(today(), 1)],
      ["Yesterday", shiftDay(today(), -1)],
    ];
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) days.push([q, q]);
    for (const [label, day] of days.filter(([label]) => q && label.toLowerCase().startsWith(q))) {
      // The day's note, if it is already listed, is offered once, by its label.
      const listed = items.findIndex((i) => pageOf(i.key)?.properties.day === day);
      if (listed >= 0) items.splice(listed, 1);
      items.push({ key: `day-${day}`, title: label, hint: dailyTitle(day), icon: <CalendarDays className="size-4 shrink-0 text-muted-foreground" />, link: () => ensureDaily(day) });
    }
  }
  const name = query.trim();
  if (name && !pool.some((p) => pageLabel(p.title).toLowerCase() === q)) {
    items.push({
      key: "new",
      title: `Create ${tag ? "#" : ""}“${name}”`,
      icon: <Plus className="size-4 shrink-0 text-muted-foreground" />,
      link: async () => (await createPage({ title: name, typeId: tag ? "tag" : PAGE_TYPE })).id,
    });
  }
  return items;
}

// "@Dune" or "#idea" inside a line; follows renames and icon changes.
function MentionChip({ id, tag }: { id: string; tag: boolean }) {
  space.use();
  const page = pageOf(id);
  const title = page ? pageLabel(page.title) : "Deleted page";
  if (!page) return <span className="text-muted-foreground line-through">{tag ? `#${title}` : title}</span>;
  if (tag) {
    return (
      <span className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={(e) => visit(id, e)}>
        #{title}
      </span>
    );
  }
  // Inline, so a long title wraps like the words around it.
  return (
    <span className="cursor-pointer font-medium" onClick={(e) => visit(id, e)}>
      <span className="me-1 inline-flex align-[-0.15em]">
        <RowIcon icon={iconFor(page)} />
      </span>
      <span className="underline decoration-muted-foreground/40 underline-offset-2">{title}</span>
    </span>
  );
}

// A page as a card: its cover, icon, title and the properties its type shows on cards.
export function PageCard({ page, wide, className }: { page: ObjectSummary; wide?: boolean; className?: string }) {
  const type = typeOf(page.typeId);
  const cover = readCover(page.properties.cover);
  const shown = type.card
    .map(propOf)
    .filter((p) => p !== undefined)
    .filter((p) => page.properties[p.id] !== undefined && page.properties[p.id] !== null);
  const description = typeof page.properties.description === "string" ? page.properties.description : "";
  return (
    <Card
      className={cn("ll-link-surface cursor-default overflow-hidden rounded-xl text-left before:rounded-[calc(var(--radius-xl)-1px)]", wide ? "w-full" : "w-64", className)}
      onClick={(e: React.MouseEvent) => visit(page.id, e)}
      onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && visit(page.id, e as unknown as React.MouseEvent)}
      render={<div role="link" tabIndex={0} />}
    >
      {cover && (
        <div className={cn("w-full shrink-0", wide ? "h-24" : "h-14", cover.kind === "color" && COLORS[cover.color].band)}>
          {cover.kind === "image" && <img alt="" className="size-full object-cover" src={cover.url} style={{ objectPosition: `50% ${cover.y}%` }} />}
        </div>
      )}
      <div className="flex flex-col gap-1.5 p-3">
        <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
          <RowIcon icon={iconFor(page)} />
          <span className="truncate">{pageLabel(page.title)}</span>
        </span>
        {wide && description && <span className="truncate text-muted-foreground text-sm">{description}</span>}
        {shown.length > 0 && (
          <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
            {shown.map((p) => (
              <span className="flex items-center gap-1" key={p.id}>
                {ValueView({ prop: p, value: page.properties[p.id], page })}
              </span>
            ))}
          </span>
        )}
      </div>
    </Card>
  );
}

// Embedding stops one level down: a page shown inside a page shows its own links as cards.
const Depth = createContext(0);

function EmbeddedPage({ page }: { page: ObjectSummary }) {
  const depth = useContext(Depth);
  const [obj, setObj] = useState<LLObject | null>(null);
  useEffect(() => {
    let live = true;
    void objects.get(page.id).then((o) => live && setObj(o));
    return () => {
      live = false;
    };
  }, [page.id, page.updatedAt]);
  if (depth > 0) return <PageCard page={page} wide />;
  return (
    <Card className="ll-link-surface rounded-xl p-4 before:rounded-[calc(var(--radius-xl)-1px)]">
      <button className="mb-1 flex min-w-0 items-center gap-2 text-left font-semibold" onClick={(e) => visit(page.id, e)} type="button">
        {iconFor(page) && <PageIconView icon={iconFor(page)!} />}
        <span className="truncate">{pageLabel(page.title)}</span>
      </button>
      <Depth.Provider value={depth + 1}>
        {obj && <BlockEditor assets={assets} content={obj.content} key={page.updatedAt} links={linkHost} openLink={openLink} readOnly />}
      </Depth.Provider>
    </Card>
  );
}

function LinkBlock({ id, view, setView }: { id: string; view: string | null; setView: (view: string) => void }) {
  space.use();
  const page = pageOf(id);
  if (!page) return <p className="py-1 text-muted-foreground line-through">Deleted page</p>;
  const shown = (view && view in LINK_VIEWS ? view : typeOf(page.typeId).linkView) as LinkView;
  return (
    <div className={cn("group/link relative py-1", (shown === "line" || shown === "card") && "w-fit max-w-full pe-10")}>
      {shown === "line" && (
        <button className="ll-link-surface ll-row -ms-1 flex h-8 max-w-full items-center gap-2 rounded-md px-1 text-left font-medium hover:bg-accent" onClick={(e) => visit(id, e)} type="button">
          <RowIcon icon={iconFor(page)} />
          <span className="truncate underline decoration-muted-foreground/40 underline-offset-2">{pageLabel(page.title)}</span>
        </button>
      )}
      {(shown === "card" || shown === "wide") && <PageCard page={page} wide={shown === "wide"} />}
      {shown === "page" && <EmbeddedPage page={page} />}
      <div className="absolute end-1 top-2 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/link:opacity-100 has-data-popup-open:opacity-100">
        <Menu>
          <MenuTrigger render={<Button aria-label="Link view" className="bg-popover" size="icon-xs" variant="outline" />}>
            <LayoutPanelTop className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup onValueChange={(v) => setView(v as string)} value={shown}>
              {(Object.keys(LINK_VIEWS) as LinkView[]).map((v) => (
                <MenuRadioItem closeOnClick key={v} value={v}>
                  {LINK_VIEWS[v]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  );
}

export const linkHost: LinkHost = { search, title: (id) => pageLabel(pageOf(id)?.title ?? ""), Mention: MentionChip, Block: LinkBlock };
