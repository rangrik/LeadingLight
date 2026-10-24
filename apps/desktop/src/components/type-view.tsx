import { ArrowDown, ArrowUp, ChevronDown, Plus, Settings2, Star, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Checkbox } from "@leadinglight/ui/components/checkbox";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@leadinglight/ui/components/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { cn } from "@leadinglight/ui/lib/utils";
import { ObjectList } from "~/components/object-list";
import { IconPicker, PageIconView, RowIcon } from "~/components/page-icon";
import { AddProperty } from "~/components/property-panel";
import { KIND_ICONS } from "~/components/property-value";
import type { LinkView, TypeDef, ViewSettings } from "~/lib/catalog";
import { pageLabel } from "~/lib/labels";
import { type Color, COLORS } from "~/lib/page-meta";
import { openPage } from "~/lib/panes";
import { deleteType, propOf, putType, space, typeOf, typeView } from "~/lib/space";
import { PAGE_TYPE } from "~/lib/store";
import { goToDay } from "~/components/daily-bar";
import { DAILY, today } from "~/lib/daily";
import { newPage, newTemplate, templatesOf } from "~/lib/templates";

export const LINK_VIEWS: Record<LinkView, string> = { line: "Line", card: "Small card", wide: "Wide card", page: "Page" };
const DEFAULT_VIEW: ViewSettings = { kind: "list", sort: { by: "title" } };
const DAILY_VIEW: ViewSettings = { kind: "list", sort: { by: "day", desc: true } };

// A type's home: its name, a New button, its settings and its pages.
export function TypeView({ typeId }: { typeId: string }) {
  const { pages } = space.use();
  const [editing, setEditing] = useState(false);
  const type = typeOf(typeId);
  const items = pages.filter((p) => p.typeId === type.id && !p.properties.templateOf);
  const templates = templatesOf(type.id);
  // Daily notes are one per day: "New" opens today's.
  const create = async (template?: string) => (type.id === DAILY ? goToDay(today()) : openPage((await newPage(type.id, {}, template)).id));
  const view = type.view ?? (type.id === DAILY ? DAILY_VIEW : DEFAULT_VIEW);
  const defs = (ids: string[]) => ids.map(propOf).filter((p) => p !== undefined);
  return (
    // A type's view isn't read like a page: it takes the pane's width in every view, so
    // switching views never moves its header.
    <div className="w-full max-w-[1200px] ps-6 pe-6 pt-10 @sm:ps-16 pb-48 @xl:pe-16">
      {type.icon && (
        <div className="mb-3">
          <PageIconView icon={type.icon} large />
        </div>
      )}
      <h1 className="font-bold font-heading text-[36px] leading-[1.2] tracking-tight">{type.plural}</h1>
      <div className="-ms-2 mt-3 flex flex-wrap items-center gap-1">
        <Button aria-label={`New ${type.name.toLowerCase()}`} className="text-muted-foreground" onClick={() => void create()} size="sm" variant="ghost">
          <Plus />
          <span className="hidden @md:inline">New {type.name.toLowerCase()}</span>
        </Button>
        {templates.length > 0 && (
          <Menu>
            <MenuTrigger render={<Button aria-label="New from a template" className="-ms-1 text-muted-foreground" size="icon-sm" variant="ghost" />}>
              <ChevronDown />
            </MenuTrigger>
            <MenuPopup align="start">
              {templates.map((t) => (
                <MenuItem key={t.id} onClick={() => void create(t.id)}>
                  {pageLabel(t.title)}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}
        <Button aria-label="Type settings" className="text-muted-foreground" onClick={() => setEditing(true)} size="sm" variant="ghost">
          <Settings2 />
          <span className="hidden @md:inline">Type settings</span>
        </Button>
      </div>
      <div className="mt-4">
        <ObjectList
          card={defs(type.card)}
          empty={`No ${type.plural.toLowerCase()} yet`}
          items={items}
          onSettings={(view) => void putType({ ...type, view })}
          props={defs(type.props)}
          settings={view}
        />
      </div>
      {editing && <TypeSettings onClose={() => setEditing(false)} type={type} />}
    </div>
  );
}

function TypeSettings({ type, onClose }: { type: TypeDef; onClose: () => void }) {
  const [draft, setDraft] = useState(type);
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<TypeDef>) => setDraft({ ...draft, ...patch });
  const move = (i: number, by: number) => {
    const props = [...draft.props];
    [props[i], props[i + by]] = [props[i + by], props[i]];
    set({ props });
  };
  const save = async () => {
    await putType({ ...draft, name: draft.name.trim() || type.name, plural: draft.plural.trim() || type.plural });
    onClose();
  };
  const remove = async () => {
    await deleteType(type.id);
    openPage(typeView(PAGE_TYPE));
    onClose();
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Type settings</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <IconPicker icon={draft.icon} onChange={(icon) => set({ icon })}>
              <Button aria-label="Type icon" className="size-9" size="icon" variant="outline">
                <RowIcon icon={draft.icon} />
              </Button>
            </IconPicker>
            <Field className="flex-1">
              <FieldLabel>Name</FieldLabel>
              <Input onChange={(e) => set({ name: e.currentTarget.value })} value={draft.name} />
            </Field>
            <Field className="flex-1">
              <FieldLabel>Plural</FieldLabel>
              <Input onChange={(e) => set({ plural: e.currentTarget.value })} value={draft.plural} />
            </Field>
          </div>
          <div className="flex gap-3">
            <Field className="flex-1">
              <FieldLabel>Colour</FieldLabel>
              <Select items={Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.name]))} onValueChange={(c) => set({ color: c as Color })} value={draft.color ?? "gray"}>
                <SelectTrigger aria-label="Colour">
                  <span className={cn("size-3 shrink-0 rounded-full", COLORS[draft.color ?? "gray"].dot)} />
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {(Object.keys(COLORS) as Color[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <span className={cn("size-3 rounded-full", COLORS[c].dot)} />
                        {COLORS[c].name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field className="flex-1">
              <FieldLabel>Links show as</FieldLabel>
              <Select items={LINK_VIEWS} onValueChange={(v) => set({ linkView: v as LinkView })} value={draft.linkView}>
                <SelectTrigger aria-label="Links show as">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {(Object.keys(LINK_VIEWS) as LinkView[]).map((v) => (
                    <SelectItem key={v} value={v}>
                      {LINK_VIEWS[v]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Properties</p>
            <div className="flex w-full flex-col">
              {draft.props.map((id, i) => {
                const prop = propOf(id);
                if (!prop) return null;
                const Icon = KIND_ICONS[prop.kind];
                const onCard = draft.card.includes(id);
                return (
                  <div className="flex h-9 items-center gap-2 text-sm" key={id}>
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{prop.name}</span>
                    <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <Checkbox aria-label={`Show ${prop.name} on cards`} checked={onCard} onCheckedChange={(c) => set({ card: c ? [...draft.card, id] : draft.card.filter((x) => x !== id) })} />
                      On cards
                    </label>
                    <Button aria-label={`Move ${prop.name} up`} disabled={i === 0} onClick={() => move(i, -1)} size="icon-sm" variant="ghost">
                      <ArrowUp />
                    </Button>
                    <Button aria-label={`Move ${prop.name} down`} disabled={i === draft.props.length - 1} onClick={() => move(i, 1)} size="icon-sm" variant="ghost">
                      <ArrowDown />
                    </Button>
                    <Button
                      aria-label={`Remove ${prop.name}`}
                      onClick={() => set({ props: draft.props.filter((x) => x !== id), card: draft.card.filter((x) => x !== id) })}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </div>
                );
              })}
              <AddProperty exclude={draft.props} onAdd={(p) => set({ props: [...draft.props, p.id] })}>
                <Button className="mt-1 self-start text-muted-foreground" size="sm" variant="ghost">
                  <Plus />
                  Add property
                </Button>
              </AddProperty>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-sm">Templates</p>
            <div className="flex w-full flex-col">
              {templatesOf(type.id).map((t) => (
                <div className="flex h-9 items-center gap-2 text-sm" key={t.id}>
                  <button
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                    onClick={() => {
                      onClose();
                      openPage(t.id);
                    }}
                    type="button"
                  >
                    {pageLabel(t.title)}
                  </button>
                  <Button
                    aria-label={`Make ${pageLabel(t.title)} the default`}
                    aria-pressed={draft.template === t.id}
                    onClick={() => set({ template: draft.template === t.id ? undefined : t.id })}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Star className={cn(draft.template === t.id && "fill-current text-amber-500")} />
                  </Button>
                </div>
              ))}
              <Button
                className="mt-1 self-start text-muted-foreground"
                onClick={async () => {
                  const t = await newTemplate(type.id);
                  onClose();
                  openPage(t.id);
                }}
                size="sm"
                variant="ghost"
              >
                <Plus />
                New template
              </Button>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          {!type.system &&
            (confirming ? (
              <span className="me-auto flex items-center gap-2 text-sm">
                Its pages become plain pages.
                <Button onClick={() => void remove()} size="sm" variant="destructive">
                  Delete {type.plural}
                </Button>
              </span>
            ) : (
              <Button className="me-auto" onClick={() => setConfirming(true)} variant="destructive-outline">
                Delete type
              </Button>
            ))}
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
