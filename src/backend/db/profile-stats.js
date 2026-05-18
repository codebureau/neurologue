'use strict';

/**
 * Per-profile statistics reader.
 *
 * Opens a profile's SQLite DB as a read-only snapshot (independent of the
 * active DB singleton) and extracts aggregate data for the portfolio view.
 */

const fs   = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

/**
 * Return the total size in bytes of a directory tree (non-throwing).
 * @param {string} dirPath
 * @returns {number}
 */
function _dirSizeBytes(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += _dirSizeBytes(full);
      } else {
        try { total += fs.statSync(full).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip unreadable dirs */ }
  return total;
}

/**
 * Query a profile's DB for statistics and highlights.
 * Safe to call on a DB that hasn't been initialised yet (returns zeros).
 *
 * @param {string} dbPath            Absolute path to the profile's .db file.
 * @param {string} [vectorStorePath] Absolute path to the profile's vector store directory.
 * @returns {Promise<{
 *   entryCount: number,
 *   tagCount: number,
 *   themeCount: number,
 *   openContradictions: number,
 *   lastActiveAt: string|null,
 *   topThemes: string[],
 *   recentEntries: { content: string }[],
 *   dbSizeBytes: number,
 *   vectorStoreSizeBytes: number,
 * }>}
 */
async function getProfileStats(dbPath, vectorStorePath) {
  const dbSizeBytes = dbPath && fs.existsSync(dbPath)
    ? (() => { try { return fs.statSync(dbPath).size; } catch { return 0; } })()
    : 0;
  const vectorStoreSizeBytes = _dirSizeBytes(vectorStorePath);

  const empty = {
    entryCount: 0,
    tagCount: 0,
    themeCount: 0,
    openContradictions: 0,
    lastActiveAt: null,
    topThemes: [],
    recentEntries: [],
    dbSizeBytes,
    vectorStoreSizeBytes,
  };

  if (!dbPath || !fs.existsSync(dbPath)) return empty;

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
  });

  let db;
  try {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } catch {
    return empty;
  }

  function queryOne(sql) {
    try {
      const stmt = db.prepare(sql);
      const row  = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    } catch {
      return null;
    }
  }

  function queryAll(sql) {
    try {
      const stmt = db.prepare(sql);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    } catch {
      return [];
    }
  }

  const entryRow  = queryOne('SELECT COUNT(*) AS n FROM entries');
  const tagRow    = queryOne('SELECT COUNT(*) AS n FROM tags');
  const themeRow  = queryOne('SELECT COUNT(*) AS n FROM themes');
  const contraRow = queryOne("SELECT COUNT(*) AS n FROM contradictions WHERE status = 'active'");
  const lastRow   = queryOne('SELECT MAX(created_at) AS last FROM entries');

  const topThemes = queryAll(
    'SELECT name FROM themes ORDER BY updated_at DESC LIMIT 5'
  ).map((r) => r.name).filter(Boolean);

  const recentEntries = queryAll(
    'SELECT content FROM entries WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 3'
  ).map((r) => ({ content: (r.content || '').slice(0, 120) }));

  db.close();

  return {
    entryCount:          Number(entryRow?.n  ?? 0),
    tagCount:            Number(tagRow?.n    ?? 0),
    themeCount:          Number(themeRow?.n  ?? 0),
    openContradictions:  Number(contraRow?.n ?? 0),
    lastActiveAt:        lastRow?.last ?? null,
    topThemes,
    recentEntries,
    dbSizeBytes,
    vectorStoreSizeBytes,
  };
}

module.exports = { getProfileStats };
