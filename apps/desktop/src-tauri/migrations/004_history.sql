ALTER TABLE objects ADD COLUMN revision TEXT;
CREATE TABLE page_history (id TEXT PRIMARY KEY, at INTEGER NOT NULL, entry TEXT NOT NULL CHECK(json_valid(entry)));
CREATE INDEX page_history_by_time ON page_history(at);

-- One insert saves every page in an action and its history in the same transaction.
CREATE TRIGGER apply_page_history AFTER INSERT ON page_history BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.entry, '$.changes') AS c
    LEFT JOIN objects AS o ON o.id = COALESCE(json_extract(c.value, '$.after.id'), json_extract(c.value, '$.before.id')) AND o.deleted_at IS NULL
    WHERE (json_type(c.value, '$.before') = 'null' AND o.id IS NOT NULL)
      OR (json_type(c.value, '$.before') != 'null' AND (o.id IS NULL OR COALESCE(o.revision, '') != COALESCE(json_extract(c.value, '$.before.revision'), '')))
  ) THEN RAISE(ABORT, 'history_conflict') END;

  INSERT INTO objects (id, type_id, title, content, properties, created_at, updated_at, deleted_at, revision)
  SELECT json_extract(c.value, '$.after.id'), json_extract(c.value, '$.after.typeId'),
    json_extract(c.value, '$.after.title'), COALESCE(json_extract(c.value, '$.after.content'), 'null'),
    json_extract(c.value, '$.after.properties'), json_extract(c.value, '$.after.createdAt'),
    json_extract(c.value, '$.after.updatedAt'), NULL, NEW.id
  FROM json_each(NEW.entry, '$.changes') AS c WHERE json_type(c.value, '$.after') != 'null'
  ON CONFLICT(id) DO UPDATE SET type_id = excluded.type_id, title = excluded.title,
    content = excluded.content, properties = excluded.properties, updated_at = excluded.updated_at,
    deleted_at = NULL, revision = excluded.revision;

  UPDATE objects SET deleted_at = NEW.at, revision = NEW.id WHERE id IN (
    SELECT json_extract(c.value, '$.before.id') FROM json_each(NEW.entry, '$.changes') AS c
    WHERE json_type(c.value, '$.after') = 'null'
  );
END;
