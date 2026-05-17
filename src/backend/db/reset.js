'use strict';

const { openDb } = require('./connection');

// All data tables in dependency order (most-derived first) so that FK
// constraints are satisfied even on databases where PRAGMA foreign_keys is ON.
// The schema (tables, indexes, migrations log) is preserved — only rows are removed.
const CLEAR_ORDER = [
  'theme_metrics',
  'entry_signals',
  'contradictions',
  'entry_revisions',
  'embeddings',
  'theme_entries',
  'entry_tags',
  'themes',
  'tags',
  'entries',
];

/**
 * Wipe every data row from the database while keeping the schema intact.
 *
 * @param {{ keepTags?: boolean }} [options]
 *   keepTags — when true, the `tags` table is preserved so the user's tag
 *   taxonomy survives a Start Fresh. `entry_tags` (the join table) is always
 *   cleared because those rows reference entries that no longer exist.
 *
 * Returns `{ tablesCleared, rowsRemaining }`.
 */
async function resetDb({ keepTags = false } = {}) {
  const db = await openDb();

  const skip = new Set(keepTags ? ['tags'] : []);

  for (const table of CLEAR_ORDER) {
    if (skip.has(table)) continue;
    // Skip tables that may not exist yet (e.g. on an older migration level)
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) continue;

    db.prepare(`DELETE FROM ${table}`).run();
  }

  // Count total remaining rows as a sanity figure for callers
  let remaining = 0;
  for (const table of CLEAR_ORDER) {
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) continue;
    const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
    remaining += row ? row.n : 0;
  }

  return { tablesCleared: CLEAR_ORDER.length, rowsRemaining: remaining };
}

module.exports = { resetDb, CLEAR_ORDER };
