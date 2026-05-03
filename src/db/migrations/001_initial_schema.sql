-- Migration: initial schema
-- Creates all core tables for Neurologue

CREATE TABLE IF NOT EXISTS entries (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  content     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | clipboard | image
  type        TEXT NOT NULL DEFAULT 'note',   -- note | idea | task
  metadata    TEXT NOT NULL DEFAULT '{}'      -- JSON blob
);

CREATE TABLE IF NOT EXISTS tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id  TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  entry_id    TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  vector      BLOB NOT NULL,
  model_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS theme_entries (
  theme_id  TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  entry_id  TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  score     REAL NOT NULL DEFAULT 0.0,
  PRIMARY KEY (theme_id, entry_id)
);
