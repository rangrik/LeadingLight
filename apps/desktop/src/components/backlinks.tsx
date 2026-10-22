import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { cn } from "@leadinglight/ui/lib/utils";
import { RowIcon } from "~/components/page-icon";
import { visit } from "~/components/property-value";
import { hasBlockLink, lineText, linesMentioning, linesSaying, linkFirst } from "~/lib/doc-links";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import { type LLObject, objects } from "~/lib/objects";
import { iconFor, pageOf, space, typeOf } from "~/lib/space";

type Source = { page: LLObject; lines: string[]; via: string[]; block: boolean };

const titleOf = (id: string) => pageLabel(pageOf(id)?.title ?? "");
const asIds = (v: unknown) => (Array.isArray(v) ? v : []);

// Everything that links to this page, then pages that name it without a link. Links through a
// two-way property show on the page itself, so they are left out here.
export function Backlinks({ id, title }: { id: string; title: string }) {
  const { saved, props } = space.use();
  const [linked, setLinked] = useState<Source[]>([]);
  const [unlinked, setUnlinked] = useState<Source[]>([]);
  const [open, setOpen] = useState(false);
  const name = title.trim();

  useEffect(() => {
    let live = true;
    const relations = props.filter((p) => p.kind === "relation" && !p.options.reverse);
    // Saves come in bursts while typing; look again once they settle.
    const timer = setTimeout(async () => {
      const [byId, byName] = await Promise.all([objects.containing(id), name.length >= 3 ? objects.containing(name) : Promise.resolve([])]);
      if (!live) return;
      const sources = byId
        .filter((o) => o.id !== id)
        .map((o) => ({
          page: o,
          lines: linesMentioning(o.content, id).map((b) => lineText(b, titleOf)),
          via: relations.filter((p) => asIds(o.properties[p.id]).includes(id)).map((p) => p.name),
          block: hasBlockLink(o.content, id),
        }))
        .filter((s) => s.lines.length || s.via.length || s.block);
      const linkedIds = new Set(byId.map((o) => o.id));
      setLinked(sources);
      setUnlinked(
        byName
          .filter((o) => o.id !== id && !linkedIds.has(o.id))
          .map((o) => ({ page: o, lines: linesSaying(o.content, name).map((b) => lineText(b, titleOf)), via: [], block: false }))
          .filter((s) => s.lines.length),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, name, saved, props]);

  if (!linked.length && !unlinked.length) return null;
  return (
    <section aria-label="Backlinks" className="mt-16 border-t pt-6 text-sm">
      {linked.length > 0 && (
        <>
          <h2 className="mb-2 font-medium text-muted-foreground">Backlinks · {linked.length}</h2>
          <div className="flex flex-col gap-3">
            {linked.map((s) => (
              <SourceRow key={s.page.id} source={s} />
            ))}
          </div>
        </>
      )}
      {unlinked.length > 0 && (
        <div className={cn(linked.length > 0 && "mt-6")}>
          <button aria-expanded={open} className="-ms-1 flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} type="button">
            <ChevronRight className={cn("size-4 transition-transform duration-150", open && "rotate-90")} />
            Unlinked mentions · {unlinked.length}
          </button>
          {open && (
            <div className="mt-2 flex flex-col gap-3">
              {unlinked.map((s) => (
                <SourceRow key={s.page.id} source={s}>
                  <Button
                    className="ms-auto"
                    onClick={() => void editPage(s.page.id, { content: (doc) => linkFirst(doc, name, id) })}
                    size="xs"
                    variant="outline"
                  >
                    Link
                  </Button>
                </SourceRow>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SourceRow({ source, children }: { source: Source; children?: React.ReactNode }) {
  const page = pageOf(source.page.id) ?? source.page;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button className="-ms-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent" onClick={(e) => visit(page.id, e)} type="button">
          <RowIcon icon={iconFor(page)} />
          {/* One baseline for the title and its type. */}
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium">{pageLabel(page.title)}</span>
            <span className="shrink-0 text-muted-foreground text-xs">{typeOf(page.typeId).name}</span>
          </span>
        </button>
        {children}
      </div>
      {source.lines.map((line, i) => (
        <p className="ms-6 line-clamp-2 text-muted-foreground" key={i}>
          {line}
        </p>
      ))}
      {source.via.length > 0 && <p className="ms-6 text-muted-foreground text-xs">Through {source.via.join(", ")}</p>}
      {source.block && !source.lines.length && <p className="ms-6 text-muted-foreground text-xs">Linked on its own line</p>}
    </div>
  );
}
