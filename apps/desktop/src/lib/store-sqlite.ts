import Database from "@tauri-apps/plugin-sql";
import { asDoc, type LLObject, newObject, type ObjectStore } from "./store";

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

function fromRow(r: Row): LLObject {
  return {
    id: r.id,
    typeId: r.type_id,
    title: r.title,
    content: asDoc(JSON.parse(r.content)),
    properties: JSON.parse(r.properties),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const sqliteStore: ObjectStore = {
  async list() {
    const rows = await (await db()).select<Row[]>(
      "SELECT id, type_id, title, created_at FROM objects WHERE deleted_at IS NULL ORDER BY created_at DESC",
    );
    return rows.map((r) => ({ id: r.id, typeId: r.type_id, title: r.title, createdAt: r.created_at }));
  },

  async get(id) {
    const rows = await (await db()).select<Row[]>(
      "SELECT * FROM objects WHERE id = $1 AND deleted_at IS NULL",
      [id],
    );
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async create(typeId) {
    const obj = newObject(typeId);
    await (await db()).execute(
      "INSERT INTO objects (id, type_id, title, content, properties, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [obj.id, obj.typeId, "", "null", "{}", obj.createdAt, obj.updatedAt],
    );
    return obj;
  },

  async update(id, patch) {
    await (await db()).execute(
      "UPDATE objects SET title = COALESCE($1, title), content = COALESCE($2, content), updated_at = $3 WHERE id = $4",
      [patch.title ?? null, patch.content ? JSON.stringify(patch.content) : null, Date.now(), id],
    );
  },

  // Soft delete so a trash view can restore it later.
  async remove(id) {
    await (await db()).execute("UPDATE objects SET deleted_at = $1 WHERE id = $2", [Date.now(), id]);
  },
};
