import type { PropDef, TypeDef } from "./catalog";
import { pageLabel } from "./labels";
import { type LLObject, type ObjectPatch, type ObjectSummary, objects } from "./objects";
import { type PageIcon, readIcon } from "./page-meta";
import { reportSaveError } from "./saving";
import { closePane, leaves, panes, showOnly } from "./panes";
import { createStore } from "./state";
import { starter } from "./starter";
import { PAGE_TYPE, summarize } from "./store";

// Every page's summary, every type and every property, kept in memory: lists, cards, links and
// pickers read from here instead of asking the store. Writes go to the store and here together.
export type Space = { pages: ObjectSummary[]; types: TypeDef[]; props: PropDef[]; saved: number };

export const space = createStore<Space>({ pages: [], types: [], props: [], saved: 0 });

const set = (patch: Partial<Space>) => space.set({ ...space.get(), ...patch });
const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
const byAge = <T extends { createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt;

export async function loadSpace(): Promise<ObjectSummary[]> {
  const [pages, catalog] = await Promise.all([objects.list(), objects.catalog()]);
  const seed = starter(catalog);
  await Promise.all([...seed.props.map(objects.putProp), ...seed.types.map(objects.putType)]);
  set({
    pages,
    types: seed.types.reduce(upsert, catalog.types).sort(byAge),
    props: seed.props.reduce(upsert, catalog.props).sort(byAge),
  });
  return pages;
}

const PLAIN: TypeDef = { id: PAGE_TYPE, name: "Page", plural: "Pages", props: [], card: [], linkView: "line", createdAt: 0 };

// A page of a deleted type reads as a plain page.
export const typeOf = (id: string) => {
  const { types } = space.get();
  return types.find((t) => t.id === id) ?? types.find((t) => t.id === PAGE_TYPE) ?? PLAIN;
};
export const pageOf = (id: string) => space.get().pages.find((p) => p.id === id);
export const propOf = (id: string) => space.get().props.find((p) => p.id === id);

// A page's properties: its type's in order, then its own. A key with no definition is kept in
// storage but not shown.
export function propsOf(typeId: string, values: Record<string, unknown>) {
  const type = typeOf(typeId);
  const defined = (id: string) => propOf(id);
  return {
    type: type.props.map(defined).filter((p) => p !== undefined),
    own: Object.keys(values)
      .filter((k) => !type.props.includes(k))
      .map(defined)
      .filter((p) => p !== undefined),
  };
}

// A page's own icon, else its type's.
export const iconFor = (p: ObjectSummary): PageIcon | undefined => readIcon(p.properties.icon) ?? typeOf(p.typeId).icon;

// What a pane shows: a page by its id, or a type's list of pages.
export const TYPE_VIEW = "type:";
export const typeView = (id: string) => `${TYPE_VIEW}${id}`;
export function describe(view: string): { title: string; icon?: PageIcon; parent: string } {
  if (view.startsWith(TYPE_VIEW)) {
    const type = typeOf(view.slice(TYPE_VIEW.length));
    return { title: type.plural, icon: type.icon, parent: "Types" };
  }
  const page = pageOf(view);
  return { title: pageLabel(page?.title ?? ""), icon: page && iconFor(page), parent: typeOf(page?.typeId ?? PAGE_TYPE).plural };
}

export function savePage(id: string, patch: ObjectPatch): Promise<void> {
  return objects.update(id, patch).then(() => {
    patchSummary(id, { updatedAt: Date.now() });
    markSaved();
  }, reportSaveError);
}

export function patchSummary(id: string, patch: Partial<ObjectSummary>) {
  set({ pages: space.get().pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
}

export async function createPage(init?: Partial<LLObject>): Promise<LLObject> {
  const obj = await objects.create(init);
  set({ pages: [summarize(obj), ...space.get().pages] });
  return obj;
}

export function forgetPage(id: string) {
  set({ pages: space.get().pages.filter((p) => p.id !== id) });
}

// What the sidebar's Pages list shows: tags and daily notes have their own places, and
// templates show in their type's settings.
export const listed = (p: ObjectSummary) => p.typeId !== "tag" && p.typeId !== "daily" && !p.properties.templateOf;

// A deleted page's pane closes; when it was the only one, the next page takes its place.
export function removePage(id: string) {
  objects.remove(id).catch(console.error);
  forgetPage(id);
  // A deleted default template is no longer the default.
  for (const t of space.get().types.filter((t) => t.template === id)) void putType({ ...t, template: undefined });
  const { root } = panes.get();
  const open = root && leaves(root).find((l) => l.page === id);
  if (!open) return;
  if (root.kind === "split") closePane(open.id);
  else showOnly(space.get().pages.find(listed)?.id ?? null);
}

export const markSaved = () => set({ saved: space.get().saved + 1 });

export async function putType(type: TypeDef) {
  set({ types: upsert(space.get().types, type) });
  await objects.putType(type);
}

// Its pages become plain pages; its templates go with it.
export async function deleteType(id: string) {
  const { pages, types } = space.get();
  const templates = pages.filter((p) => p.properties.templateOf === id);
  set({
    types: types.filter((t) => t.id !== id),
    pages: pages.filter((p) => !templates.includes(p)).map((p) => (p.typeId === id ? { ...p, typeId: PAGE_TYPE } : p)),
  });
  await Promise.all(templates.map((t) => objects.remove(t.id)));
  await objects.deleteType(id);
}

export async function putProp(prop: PropDef) {
  set({ props: upsert(space.get().props, prop) });
  await objects.putProp(prop);
}

// Values on pages stay stored; they just stop showing.
export async function deleteProp(id: string) {
  const users = space.get().types.filter((t) => t.props.includes(id) || t.card.includes(id));
  set({ props: space.get().props.filter((p) => p.id !== id) });
  await Promise.all(users.map((t) => putType({ ...t, props: t.props.filter((p) => p !== id), card: t.card.filter((p) => p !== id) })));
  await objects.deleteProp(id);
}
