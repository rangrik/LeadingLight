import Database from "@tauri-apps/plugin-sql";
import type { PropDef, TypeDef } from "./catalog";
import { readIcon } from "./page-meta";
import { asDoc, type LLObject, newObject, type ObjectStore, PAGE_TYPE } from "./store";

// Must match DB_URL in src-tauri/src/lib.rs.
const DB_URL = "sqlite:leadinglight.db";

type Row = {
  id: string;
  type_id: string;
  title: string;
  content: string;
  properties: string;
  created_at: number;
  updated_at: number;
};

let dbPromise: Promise<Database> | undefined;

function db(): Promise<Database> {
  dbPromise ??= Database.load(DB_URL);
  return dbPromise;
}

const parse = <T>(text: string | null, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

function fromRow(r: Row): LLObject {
  return {
    id: r.id,
    typeId: r.type_id,
    title: r.title,
    content: asDoc(parse(r.content, null)),
    properties: parse(r.properties, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// LIKE treats % and _ as wildcards; a title may hold them.
const like = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const sqliteStore: ObjectStore = {
  async list() {
    const rows = await (await db()).select<Row[]>(
      "SELECT id, type_id, title, properties, created_at, updated_at FROM objects WHERE deleted_at IS NULL ORDER BY created_at DESC",
    );
    return rows.map((r) => ({
      id: r.id,
      typeId: r.type_id,
      title: r.title,
      properties: parse(r.properties, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async get(id) {
    const rows = await (await db()).select<Row[]>("SELECT * FROM objects WHERE id = $1 AND deleted_at IS NULL", [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async create(init) {
    const obj = newObject(init);
    await (await db()).execute(
      "INSERT INTO objects (id, type_id, title, content, properties, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [obj.id, obj.typeId, obj.title, JSON.stringify(obj.content), JSON.stringify(obj.properties), obj.createdAt, obj.updatedAt],
    );
    return obj;
  },

  async update(id, patch) {
    await (await db()).execute(
      "UPDATE objects SET title = COALESCE($1, title), content = COALESCE($2, content), properties = COALESCE($3, properties), type_id = COALESCE($4, type_id), updated_at = $5 WHERE id = $6",
      [
        patch.title ?? null,
        patch.content ? JSON.stringify(patch.content) : null,
        patch.properties ? JSON.stringify(patch.properties) : null,
        patch.typeId ?? null,
        Date.now(),
        id,
      ],
    );
  },

  // Soft delete so a trash view can restore it later.
  async remove(id) {
    await (await db()).execute("UPDATE objects SET deleted_at = $1 WHERE id = $2", [Date.now(), id]);
  },

  async containing(text) {
    const rows = await (await db()).select<Row[]>(
      "SELECT * FROM objects WHERE deleted_at IS NULL AND (content LIKE $1 ESCAPE '\\' OR properties LIKE $1 ESCAPE '\\')",
      [like(text)],
    );
    return rows.map(fromRow);
  },

  async catalog() {
    const d = await db();
    const types = await d.select<{ id: string; name: string; plural: string; icon: string | null; properties: string; settings: string; created_at: number }[]>(
      "SELECT id, name, plural, icon, properties, settings, created_at FROM object_types ORDER BY created_at",
    );
    const props = await d.select<{ id: string; name: string; kind: string; options: string; created_at: number }[]>(
      "SELECT * FROM property_defs ORDER BY created_at",
    );
    return {
      types: types.map((t): TypeDef => ({
        card: [],
        linkView: "line",
        ...parse<Partial<TypeDef>>(t.settings, {}),
        id: t.id,
        name: t.name,
        plural: t.plural,
        icon: readIcon(parse(t.icon, null)),
        props: parse(t.properties, []),
        createdAt: t.created_at,
      })),
      props: props.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind as PropDef["kind"],
        options: parse(p.options, {}),
        createdAt: p.created_at,
      })),
    };
  },

  async putType({ id, name, plural, icon, props, createdAt, ...settings }) {
    await (await db()).execute(
      `INSERT INTO object_types (id, name, plural, icon, properties, settings, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, plural = excluded.plural, icon = excluded.icon,
         properties = excluded.properties, settings = excluded.settings, updated_at = excluded.updated_at`,
      [id, name, plural, icon ? JSON.stringify(icon) : null, JSON.stringify(props), JSON.stringify(settings), createdAt, Date.now()],
    );
  },

  async deleteType(id) {
    const d = await db();
    await d.execute("UPDATE objects SET type_id = $1 WHERE type_id = $2", [PAGE_TYPE, id]);
    await d.execute("DELETE FROM object_types WHERE id = $1", [id]);
  },

  async putProp({ id, name, kind, options, createdAt }) {
    await (await db()).execute(
      `INSERT INTO property_defs (id, name, kind, options, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, options = excluded.options`,
      [id, name, kind, JSON.stringify(options), createdAt],
    );
  },

  async deleteProp(id) {
    await (await db()).execute("DELETE FROM property_defs WHERE id = $1", [id]);
  },
};
