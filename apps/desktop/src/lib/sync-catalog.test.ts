import assert from "node:assert/strict";
import { test } from "node:test";
import { starter } from "./starter.ts";
import { initialCatalogChanges } from "./sync-catalog.ts";
import type { Catalog } from "./catalog";

// Fresh native stores must adopt desktop settings without overwriting receiver customizations.
test("initial catalog adopts factory settings and missing definitions, preserving customized receivers", () => {
  const factory = starter({ types: [], props: [] });
  const local = structuredClone(factory), remote = structuredClone(factory);
  const page = remote.types.find((item) => item.id === "page")!;
  page.props = ["tags", "created", "updated"];
  remote.props.find((item) => item.id === "aliases")!.name = "Other names";
  remote.types.push({ ...page, id: "custom", name: "Custom", system: false });
  remote.props.push({ id: "custom", name: "Custom", kind: "text", options: {}, createdAt: 99 });
  local.types.find((item) => item.id === "book")!.props.reverse();
  local.types.find((item) => item.id === "person")!.name = "My people";
  local.props.find((item) => item.id === "tags")!.options.many = false;
  const before = JSON.stringify({ local, remote });
  const changed = initialCatalogChanges(local, remote);
  assert.deepEqual(changed.types.map((item) => item.id), ["page", "custom"]);
  assert.deepEqual(changed.types[0].props, ["tags", "created", "updated"]);
  assert.deepEqual(changed.props.map((item) => item.id), ["aliases", "custom"]);
  assert.equal(JSON.stringify({ local, remote }), before);
  const applied: Catalog = {
    types: [...local.types.filter((item) => !changed.types.some((next) => next.id === item.id)), ...changed.types],
    props: [...local.props.filter((item) => !changed.props.some((next) => next.id === item.id)), ...changed.props],
  };
  page.props = ["updated"];
  assert.deepEqual(initialCatalogChanges(applied, remote), { types: [], props: [] });
  assert.deepEqual(initialCatalogChanges(local, { types: [], props: [] }), { types: [], props: [] });
});

test("factory comparison ignores timestamps and object key order, while preserving array order", () => {
  const factory = starter({ types: [], props: [] });
  const tags = factory.props.find((item) => item.id === "tags")!;
  const local: Catalog = { types: [], props: [{ options: { type: "tag", many: true }, createdAt: 1, kind: tags.kind, name: tags.name, id: tags.id }] };
  const incoming: Catalog = { types: [], props: [{ ...tags, name: "Labels", createdAt: 999 }] };
  assert.equal(initialCatalogChanges(local, incoming).props[0], incoming.props[0]);
  assert.deepEqual(initialCatalogChanges(factory, { types: factory.types.map((item) => ({ ...item, createdAt: 0 })), props: factory.props.map((item) => ({ ...item, createdAt: 0 })) }), { types: [], props: [] });
});
