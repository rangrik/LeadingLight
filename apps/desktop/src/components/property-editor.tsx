import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@leadinglight/ui/components/button";
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "@leadinglight/ui/components/dialog";
import { Field, FieldLabel } from "@leadinglight/ui/components/field";
import { Input } from "@leadinglight/ui/components/input";
import { Label } from "@leadinglight/ui/components/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@leadinglight/ui/components/select";
import { Switch } from "@leadinglight/ui/components/switch";
import { cn } from "@leadinglight/ui/lib/utils";
import { type Kind, KINDS, newId, type PropDef, type PropOptions } from "~/lib/catalog";
import { type Color, COLORS } from "~/lib/page-meta";
import { putProp, putType, space } from "~/lib/space";

// Fixed kinds come from the page itself and can't change.
const EDITABLE: Kind[] = (Object.keys(KINDS) as Kind[]).filter((k) => k !== "created" && k !== "updated");
const ANY = "any";

export const defaultOptions = (kind: Kind): PropOptions => (kind === "select" ? { choices: [] } : kind === "relation" ? { many: true } : {});

// A new kind can't read the old values, so the old property stays, renamed, holding them;
// types switch to a fresh one.
async function changeKind(prop: PropDef, name: string, kind: Kind, options: PropOptions): Promise<PropDef> {
  const fresh: PropDef = { id: newId("p_"), name, kind, options, createdAt: Date.now() };
  await putProp(fresh);
  await putProp({ ...prop, name: `${prop.name} (old)` });
  const swap = (ids: string[]) => ids.map((id) => (id === prop.id ? fresh.id : id));
  for (const t of space.get().types.filter((t) => t.props.includes(prop.id))) await putType({ ...t, props: swap(t.props), card: swap(t.card) });
  return fresh;
}

// onReplaced: a kind change made a fresh property; a page holding the old one as its own adds it.
export function PropertyEditor({ prop, onClose, onReplaced }: { prop: PropDef; onClose: () => void; onReplaced?: (fresh: PropDef) => void }) {
  const [name, setName] = useState(prop.name);
  const [kind, setKind] = useState<Kind>(prop.kind);
  const [options, setOptions] = useState<PropOptions>(prop.options);
  const { types } = space.use();
  const set = (patch: PropOptions) => setOptions({ ...options, ...patch });
  const choices = options.choices ?? [];
  // A property by that name would be a second description beside the line under the title.
  const taken = name.trim().toLowerCase() === "description";
  const setChoice = (i: number, patch: Partial<(typeof choices)[number]>) => set({ choices: choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const save = async () => {
    if (taken) return;
    const clean = name.trim() || prop.name;
    if (kind === prop.kind) await putProp({ ...prop, name: clean, options: { ...options, choices: options.choices?.filter((c) => c.name.trim()) } });
    else onReplaced?.(await changeKind(prop, clean, kind, { ...defaultOptions(kind), many: options.many }));
    onClose();
  };

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogPopup className="max-w-md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
        <DialogHeader>
          <DialogTitle>Edit property</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-4">
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input onChange={(e) => setName(e.currentTarget.value)} value={name} />
            {taken && <p className="text-muted-foreground text-sm">A page's description is the line under its title.</p>}
          </Field>
          <Field>
            <FieldLabel>Kind</FieldLabel>
            <Select disabled={!EDITABLE.includes(prop.kind)} items={KINDS} onValueChange={(v) => setKind(v as Kind)} value={kind}>
              <SelectTrigger aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {EDITABLE.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KINDS[k]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {kind !== prop.kind && (
              <p className="text-muted-foreground text-sm">Values already set stay in “{prop.name} (old)”.</p>
            )}
          </Field>
          {(kind === "select" || kind === "relation") && (
            <Label>
              <Switch checked={Boolean(options.many)} onCheckedChange={(many) => set({ many })} />
              Allow more than one
            </Label>
          )}
          {kind === "date" && (
            <>
              <Label>
                <Switch checked={Boolean(options.time)} onCheckedChange={(time) => set({ time })} />
                Include a time
              </Label>
              <Label>
                <Switch checked={Boolean(options.range)} onCheckedChange={(range) => set({ range })} />
                Allow a range
              </Label>
            </>
          )}
          {kind === "relation" && (
            <>
              <Field>
                <FieldLabel>Linked pages are</FieldLabel>
                <Select
                  items={{ [ANY]: "Any type", ...Object.fromEntries(types.map((t) => [t.id, t.plural])) }}
                  onValueChange={(v) => set({ type: v === ANY ? undefined : (v as string) })}
                  value={options.type ?? ANY}
                >
                  <SelectTrigger aria-label="Linked pages are">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ANY}>Any type</SelectItem>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.plural}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Name on the linked pages</FieldLabel>
                <Input onChange={(e) => set({ reverse: e.currentTarget.value || undefined })} placeholder="Not shown" value={options.reverse ?? ""} />
              </Field>
            </>
          )}
          {kind === "select" && prop.kind === "select" && (
            <div className="flex flex-col gap-2">
              <p className="font-medium text-sm">Options</p>
              <div className="flex w-full flex-col gap-1.5">
                {choices.map((c, i) => (
                  <div className="flex items-center gap-1.5" key={c.id}>
                    <Select items={Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.name]))} onValueChange={(color) => setChoice(i, { color: color as Color })} value={c.color}>
                      <SelectTrigger aria-label={`Colour of ${c.name}`} className="w-28" size="sm">
                        <span className={cn("size-3 shrink-0 rounded-full", COLORS[c.color].dot)} />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {(Object.keys(COLORS) as Color[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            <span className="flex items-center gap-2">
                              <span className={cn("size-3 rounded-full", COLORS[k].dot)} />
                              {COLORS[k].name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Input aria-label="Option name" onChange={(e) => setChoice(i, { name: e.currentTarget.value })} size="sm" value={c.name} />
                    <Button aria-label={`Remove ${c.name}`} onClick={() => set({ choices: choices.filter((_, j) => j !== i) })} size="icon-sm" variant="ghost">
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  className="self-start"
                  onClick={() => set({ choices: [...choices, { id: newId(""), name: "", color: "gray" }] })}
                  size="sm"
                  variant="ghost"
                >
                  <Plus />
                  Add option
                </Button>
              </div>
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={taken} type="submit">
            Save
          </Button>
        </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
