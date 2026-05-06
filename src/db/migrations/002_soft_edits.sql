-- Migration: soft edit model
-- Adds edited_at + original_content tracking to entries and a full revision history table.

-- Track when an entry was last edited and preserve the very first version inline
ALTER TABLE entries ADD COLUMN edited_at       TEXT;
ALTER TABLE entries ADD COLUMN original_content TEXT;

-- Full revision history: one row per save, newest first
CREATE TABLE IF NOT EXISTS entry_revisions (
  id         TEXT PRIMARY KEY,
  entry_id   TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entry_revisions_entry_id ON entry_revisions(entry_id);
