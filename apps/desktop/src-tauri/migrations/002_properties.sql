-- Types keep their extra settings (colour, card, link view, template) as JSON, and
-- properties are defined once for the whole space.
ALTER TABLE object_types ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';

CREATE TABLE property_defs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  options    TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
