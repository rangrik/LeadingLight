-- Every note is an object of some type. Types carry a property schema so
-- richer kinds (Person, Book, Meeting, ...) can be added without new tables.
CREATE TABLE object_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  plural     TEXT NOT NULL,
  icon       TEXT,
  properties TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE objects (
  id         TEXT PRIMARY KEY,
  type_id    TEXT NOT NULL REFERENCES object_types(id),
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '[]',
  properties TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX objects_by_type ON objects (type_id, deleted_at, created_at);

INSERT INTO object_types (id, name, plural, icon, created_at, updated_at)
VALUES ('page', 'Page', 'Pages', 'file-text',
        strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
