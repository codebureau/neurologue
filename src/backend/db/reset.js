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
 * Returns `{ tablesCleared, rowsDeleted }`.
 */
async function resetDb() {
  const db = await openDb();
  let rowsDeleted = 0;

  for (const table of CLEAR_ORDER) {
    // Skip tables that may not exist yet (e.g. on an older migration level)
    const exists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    if (!exists) continue;

    db.prepare(`DELETE FROM ${table}`).run();
    // sql.js does not expose changes() on run(); count via a cheap query instead
    // (we only need this for the returned summary, not for correctness)
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
