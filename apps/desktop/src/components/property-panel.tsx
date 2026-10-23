import { ChevronsUpDown, Ellipsis, Plus, Waypoints } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@leadinglight/ui/components/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@leadinglight/ui/components/popover";
import { Select, SelectItem, SelectPopup, SelectPrimitive } from "@leadinglight/ui/components/select";
import { DeletePageDialog } from "~/components/delete-page-dialog";
import { RowIcon } from "~/components/page-icon";
import { defaultOptions, PropertyEditor } from "~/components/property-editor";
import { KIND_ICONS, PageChip, PropValue } from "~/components/property-value";
import { type Kind, KINDS, newId, type PropDef } from "~/lib/catalog";
import type { ObjectSummary } from "~/lib/objects";
import { openEssay } from "~/lib/essay";
import { pageStyle } from "~/lib/labels";
import { childOf, roleOf } from "~/lib/linked";
import { leaves, openPage, panes } from "~/lib/panes";
import { propsOf, putProp, putType, removePage, space, typeOf, typeView } from "~/lib/space";

const NEW_KINDS = (Object.keys(KINDS) as Kind[]).filter((k) => k !== "created" && k !== "updated");

// Find a property by name, or name a new one and pick its kind.
export function AddProperty({ exclude, onAdd, children }: { exclude: string[]; onAdd: (prop: PropDef) => void; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState(false);
  const { props, types } = space.use();
  const q = query.trim();
  // Which types use it, so two properties with one name can be told apart.
  const usedBy = (id: string) =>
    types
      .filter((t) => t.props.includes(id))
      .map((t) => t.plural)
      .join(", ");
  const shown = props.filter((p) => !exclude.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase()));
  const done = (prop: PropDef) => {
    onAdd(prop);
    setOpen(false);
  };
  const create = async (kind: Kind) => {
    const prop: PropDef = { id: newId("p_"), name: q, kind, options: defaultOptions(kind), createdAt: Date.now() };
    await putProp(prop);
    done(prop);
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setNaming(false);
      }}
      open={open}
    >
      <PopoverTrigger render={children} />
      <PopoverPopup align="start" aria-label="Add property" className="w-72">
        {naming ? (
          <>
            <p className="px-1 pb-2 text-muted-foreground text-sm">Kind of “{q}”</p>
            <div className="-mx-1 flex flex-col text-sm">
              {NEW_KINDS.map((k) => {
                const Icon = KIND_ICONS[k];
                return (
                  <button className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-accent" key={k} onClick={() => void create(k)} type="button">
                    <Icon className="size-4 text-muted-foreground" />
                    {KINDS[k]}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <Input
              aria-label="Find or create a property"
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && q && !shown.length && setNaming(true)}
              placeholder="Find or create a property"
              size="sm"
              value={query}
            />
            <div className="-mx-1 mt-2 flex max-h-64 flex-col overflow-y-auto text-sm *:shrink-0">
              {shown.map((p) => {
                const Icon = KIND_ICONS[p.kind];
                return (
                  <button className="flex h-8 items-center gap-2 rounded-md px-2 text-left hover:bg-accent" key={p.id} onClick={() => done(p)} type="button">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                    <span className="ms-auto shrink-0 text-muted-foreground text-xs">{usedBy(p.id) || KINDS[p.kind]}</span>
                  </button>
                );
              })}
              {q && !props.some((p) => p.name.toLowerCase() === q.toLowerCase()) && (
                <button className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-accent" onClick={() => setNaming(true)} type="button">
                  <Plus className="size-4" />
                  New property “{q}”
                </button>
              )}
            </div>
          </>
        )}
      </PopoverPopup>
    </Popover>
  );
}

type PanelProps = {
  page: ObjectSummary;
  typeId: string;
  values: Record<string, unknown>;
  setProp: (key: string, value: unknown) => void;
  setType: (typeId: string) => void;
};

const asIds = (v: unknown) => (Array.isArray(v) ? v : []);

// The line under the title: the page's type, "Add property", page options. Then one row per
// property: the type's in order, then the page's own, then pages linking here two-way.
export function PropertyPanel({ page, typeId, values, setProp, setType }: PanelProps) {
  const { types, props, pages } = space.use();
  const [editing, setEditing] = useState<PropDef | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const type = typeOf(typeId);
  const { type: typeProps, own } = propsOf(typeId, values);
  const shown = [...typeProps, ...own];
  const reverse = props
    .filter((p) => p.kind === "relation" && p.options.reverse)
    .map((p) => ({ prop: p, from: pages.filter((x) => asIds(x.properties[p.id]).includes(page.id)) }))
    .filter((r) => r.from.length > 0);
  const choosable = types.filter((t) => t.id !== "daily");
  // A page's essay opens beside it (DECISIONS.md, 11); a Thoughts page or an essay has none.
  const { root } = panes.use();
  const essay = childOf({ ...page, properties: values }, "essay");
  const essayOpen = Boolean(essay && root && leaves(root).some((l) => l.page === essay));

  const row = (prop: PropDef, isOwn: boolean) => {
    const Icon = KIND_ICONS[prop.kind];
    return (
      <div className="grid grid-cols-1 items-start @md:grid-cols-[10rem_minmax(0,1fr)] @md:gap-2" key={prop.id}>
        <Menu>
          <MenuTrigger
            render={
              <button className="-ms-2 flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-accent" type="button" />
            }
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{prop.name}</span>
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuItem onClick={() => setEditing(prop)}>Edit property</MenuItem>
            {!type.system && isOwn && <MenuItem onClick={() => void putType({ ...type, props: [...type.props, prop.id] })}>Add to {type.name}</MenuItem>}
            {!type.system && !isOwn && (
              <MenuItem onClick={() => void putType({ ...type, props: type.props.filter((p) => p !== prop.id), card: type.card.filter((p) => p !== prop.id) })}>
                Remove from {type.name}
              </MenuItem>
            )}
            {isOwn && <MenuItem onClick={() => setProp(prop.id, undefined)}>Remove from page</MenuItem>}
          </MenuPopup>
        </Menu>
        <div className="flex min-h-8 min-w-0 items-center">
          {/* An own property stays on the page when emptied; a type's simply has no value. */}
          <PropValue onChange={(v) => setProp(prop.id, v === undefined && isOwn ? null : v)} page={page} prop={prop} value={values[prop.id]} />
        </div>
      </div>
    );
  };

  return (
    <div className="mt-3 text-sm">
      <div className="-ms-2 flex flex-wrap items-center gap-1">
        <Select items={Object.fromEntries(choosable.map((t) => [t.id, t.name]))} onValueChange={(v) => setType(v as string)} value={typeId}>
          <SelectPrimitive.Trigger aria-label="Type" render={<Button className="text-muted-foreground" size="sm" variant="ghost" />}>
            <RowIcon icon={type.icon} />
            {type.name}
            <ChevronsUpDown className="size-4 opacity-60" />
          </SelectPrimitive.Trigger>
          <SelectPopup alignItemWithTrigger={false}>
            {choosable.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <RowIcon icon={t.icon} />
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <AddProperty exclude={shown.map((p) => p.id)} onAdd={(p) => setProp(p.id, values[p.id] ?? null)}>
          <Button aria-label="Add property" className="text-muted-foreground" size="sm" variant="ghost">
            <Plus />
            <span className="hidden @md:inline">Add property</span>
          </Button>
        </AddProperty>
        <Menu>
          <MenuTrigger render={<Button aria-label="Page options" className="text-muted-foreground" size="icon-sm" variant="ghost" />}>
            <Ellipsis />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuItem onClick={() => setSaving(true)}>Save as type…</MenuItem>
            <MenuItem onClick={() => openPage(typeView(typeId))}>Open {type.plural}</MenuItem>
            <MenuItem onClick={() => setDeleting(true)}>Delete page…</MenuItem>
            {!roleOf(page) && (
              <>
                <MenuSeparator />
                <MenuItem disabled={essayOpen} onClick={() => void openEssay(page.id)}>
                  {essay ? "Open essay" : "Write essay"}
                </MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Style</MenuGroupLabel>
              <MenuRadioGroup onValueChange={(style) => setProp("style", style)} value={pageStyle(values)}>
                <MenuRadioItem closeOnClick value="plain">
                  Plain
                </MenuRadioItem>
                <MenuRadioItem closeOnClick value="playful">
                  Playful
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
      {shown.length + reverse.length > 0 && (
        <div className="mt-1 flex flex-col">
          {typeProps.map((p) => row(p, false))}
          {own.map((p) => row(p, true))}
          {reverse.map(({ prop, from }) => (
            <div className="grid grid-cols-1 items-start @md:grid-cols-[10rem_minmax(0,1fr)] @md:gap-2" key={`reverse-${prop.id}`}>
              <span className="flex h-8 items-center gap-2 text-muted-foreground">
                <Waypoints className="size-4 shrink-0" />
                <span className="truncate">{prop.options.reverse}</span>
              </span>
              <div className="flex min-h-8 flex-wrap items-center gap-1 py-1">
                {from.map((p) => (
                  <PageChip id={p.id} key={p.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <DeletePageDialog
        onCancel={() => setDeleting(false)}
        onConfirm={(id) => {
          setDeleting(false);
          removePage(id);
        }}
        page={deleting ? page : null}
      />
      {editing && (
        <PropertyEditor
          onClose={() => setEditing(null)}
          onReplaced={(fresh) => own.some((p) => p.id === editing.id) && setProp(fresh.id, null)}
          prop={editing}
        />
      )}
      {saving && (
        <SaveAsType
          onClose={() => setSaving(false)}
          onSave={async (name, plural) => {
            const id = newId("t_");
            const icon = type.system ? undefined : type.icon;
            await putType({ id, name, plural, icon, color: type.color, props: shown.map((p) => p.id), card: [], linkView: "line", createdAt: Date.now() });
            setType(id);
            setSaving(false);
          }}
        />
      )}
    </div>
  );
}

function SaveAsType({ onSave, onClose }: { onSave: (name: string, plural: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [plural, setPlural] = useState<string | null>(null);
  const plurals = plural ?? (name.trim() ? `${name.trim()}s` : "");
  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogPopup className="max-w-sm">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void onSave(name.trim(), plurals.trim() || name.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Save as type</DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">The new type gets this page's properties, and this page becomes one.</p>
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input autoFocus onChange={(e) => setName(e.currentTarget.value)} placeholder="Novel" value={name} />
            </Field>
            <Field>
              <FieldLabel>Plural</FieldLabel>
              <Input onChange={(e) => setPlural(e.currentTarget.value)} placeholder="Novels" value={plurals} />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!name.trim()} type="submit">
              Save as type
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
