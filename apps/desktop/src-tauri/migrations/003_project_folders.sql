-- A page linked to a folder on this Mac (features/external-projects.feature): the page is the
-- project, the folder its files. folder_id is the folder's own identity, not its path.
CREATE TABLE project_folders (
  page_id    TEXT PRIMARY KEY,
  path       TEXT NOT NULL,
  folder_id  TEXT NOT NULL,
  location   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
