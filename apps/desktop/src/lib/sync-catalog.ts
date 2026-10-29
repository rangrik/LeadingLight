import type { Catalog } from "./catalog";
import { starter } from "./starter.ts";

const factory = starter({ types: [], props: [] });
const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, ordered(child)]));
};
const definition = ({ createdAt: _createdAt, ...value }: { createdAt: number }) => JSON.stringify(ordered(value));

// Only untouched starter definitions may adopt another device's initial settings.
export function initialCatalogChanges(local: Catalog, incoming: Catalog): Catalog {
  const changes = <T extends { id: string; createdAt: number }>(current: T[], next: T[], defaults: T[]) => {
    const existing = new Map(current.map((item) => [item.id, item]));
    const originals = new Map(defaults.map((item) => [item.id, definition(item)]));
    return next.filter((item) => {
      const previous = existing.get(item.id);
      if (previous && (definition(previous) !== originals.get(item.id) || definition(previous) === definition(item))) return false;
      existing.set(item.id, item);
      return true;
    });
  };
  return { types: changes(local.types, incoming.types, factory.types), props: changes(local.props, incoming.props, factory.props) };
}
