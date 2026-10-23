import { Merge } from "lucide-react";
import { useState } from "react";
import { showIn } from "~/lib/panes";
import { Button } from "@leadinglight/ui/components/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { ObjectList } from "~/components/object-list";
import { RowIcon } from "~/components/page-icon";
import type { ViewSettings } from "~/lib/catalog";
import { pageLabel } from "~/lib/labels";
import { editPage } from "~/lib/live";
import { objects } from "~/lib/objects";
import { closePane, leaves, openPage, panes } from "~/lib/panes";
import { forgetPage, iconFor, propOf, space, typeOf } from "~/lib/space";

const ids = (v: unknown) => (Array.isArray(v) ? v : []);
const DEFAULT_VIEW: ViewSettings = { kind: "list", sort: { by: "title" } };
const VIEW_KEY = "ll.taggedView";
// Every tag page shares one view of its tagged pages, apart from the Tags type's own list.
const savedView = (): ViewSettings => {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY) ?? "") as ViewSettings;
  } catch {
    return DEFAULT_VIEW;
  }
};

// Every link to one tag becomes a link to the other, then the first tag goes.
async function merge(from: string, into: string) {
  const swap = <T,>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll(from, into));
  // Two links to the same tag become one.
  const dedupe = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).map(([k, v]) => [k, Array.isArray(v) ? [...new Set(v)] : v]));
  for (const page of await objects.containing(from)) {
    if (page.id !== from) await editPage(page.id, { content: swap, properties: (p) => dedupe(swap(p)) });
  }
  await objects.remove(from);
  forgetPage(from);
  // The merged tag takes the place of the deleted one; other panes stay as they were.
  const { root } = panes.get();
  const open = root ? leaves(root).find((l) => l.page === from) : undefined;
  const already = root ? leaves(root).some((l) => l.page === into) : false;
  if (open && already) closePane(open.id);
  else if (open) showIn(open.id, into);
  openPage(into);
}

// On a tag's page: everything tagged with it, and merging it into another tag.
export function TagPanel({ id }: { id: string }) {
  const { pages, props } = space.use();
  const [merging, setMerging] = useState(false);
  const tagProps = props.filter((p) => p.kind === "relation" && p.options.type === "tag");
  const tagged = pages.filter((p) => !p.properties.templateOf && tagProps.some((t) => ids(p.properties[t.id]).includes(id)));
  const others = pages.filter((p) => p.typeId === "tag" && p.id !== id);
  const [settings, setSettings] = useState(savedView);
  // Columns: what the tagged pages' types show on cards.
  const card = [...new Set(tagged.flatMap((p) => typeOf(p.typeId).card))].map(propOf).filter((p) => p !== undefined);

  return (
    <section aria-label="Tagged" className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium text-muted-foreground text-sm">Tagged · {tagged.length}</h2>
        <Popover onOpenChange={setMerging} open={merging}>
          <PopoverTrigger render={<Button className="text-muted-foreground" disabled={!others.length} size="sm" variant="ghost" />}>
            <Merge />
            Merge into…
          </PopoverTrigger>
          <PopoverPopup align="end" className="w-64">
            <p className="px-1 pb-2 text-muted-foreground text-sm">Its links move to the tag you pick; then it is deleted.</p>
            <div className="-mx-1 flex max-h-60 flex-col overflow-y-auto">
              {others.map((t) => (
                <button
                  className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent"
                  key={t.id}
                  onClick={() => {
                    setMerging(false);
                    void merge(id, t.id);
                  }}
                  type="button"
                >
                  <RowIcon icon={iconFor(t)} />#{pageLabel(t.title)}
                </button>
              ))}
            </div>
          </PopoverPopup>
        </Popover>
      </div>
      <ObjectList
        card={card}
        empty="Nothing is tagged with this yet."
        items={tagged}
        onSettings={(view) => {
          setSettings(view);
          localStorage.setItem(VIEW_KEY, JSON.stringify(view));
        }}
        props={card}
        settings={settings}
      />
    </section>
  );
}
