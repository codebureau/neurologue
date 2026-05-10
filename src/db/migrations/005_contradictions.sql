-- Migration 005: Contradictions
-- Stores detected contradictions between pairs of entries.
--
-- entry_a_id is always lexicographically < entry_b_id (canonical order)
-- to allow the UNIQUE constraint to prevent duplicate detection of the same pair.
--
-- status: 'active'    — flagged, awaiting user review
--         'resolved'  — user marked it as resolved
--         'dismissed' — user said it is not a real contradiction

CREATE TABLE contradictions (
  id               TEXT PRIMARY KEY,
  entry_a_id       TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  entry_b_id       TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  theme_id         TEXT REFERENCES themes(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'active',
  resolution_notes TEXT,
  resolved_at      TEXT,
  detected_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entry_a_id, entry_b_id)
);
