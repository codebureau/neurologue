-- Track pairs that have been checked for contradictions but found clean.
-- This prevents re-checking A→B and B→A in the same scan, and avoids
-- re-examining already-checked pairs on every scheduled scan run.
-- Canonical ordering (smaller ID first) matches the contradictions table.
CREATE TABLE IF NOT EXISTS checked_pairs (
  entry_a_id TEXT NOT NULL,
  entry_b_id TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entry_a_id, entry_b_id)
);
