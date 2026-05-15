'use strict';

const { openDb } = require('./connection');

// ── Month snapshot ────────────────────────────────────────────────────────────

/**
 * Return a snapshot of cognitive activity for a specific calendar month.
 *
 * @param {number} year   e.g. 2026
 * @param {number} month  1-indexed, e.g. 5 for May
 * @returns {Promise<{
 *   year: number,
 *   month: number,
 *   entryCount: number,
 *   topThemes: { id: string, display_name: string, entryCount: number }[],
 *   entries: { id: string, content: string, created_at: string, category: string|null }[],
 * }>}
 */
async function getMonthSnapshot(year, month) {
  const db = await openDb();
  const mm   = String(month).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  // Last day of month via SQLite's date arithmetic
  const to   = `${year}-${mm}-01`;

  const entries = db.prepare(`
    SELECT id, content, created_at,
           COALESCE(user_category, category) AS category
    FROM   entries
    WHERE  DATE(created_at) >= DATE(?)
      AND  DATE(created_at) <  DATE(?, '+1 month')
    ORDER  BY created_at ASC
  `).all(from, to);

  const entryIds = entries.map((e) => e.id);

  let topThemes = [];
  if (entryIds.length > 0) {
    // For each theme, count how many of its entries fall in this month
    topThemes = db.prepare(`
      SELECT t.id,
             COALESCE(t.user_name, t.name) AS display_name,
             COUNT(te.entry_id)            AS entry_count
      FROM   theme_entries te
      JOIN   themes t ON t.id = te.theme_id
      JOIN   entries e ON e.id = te.entry_id
      WHERE  DATE(e.created_at) >= DATE(?)
        AND  DATE(e.created_at) <  DATE(?, '+1 month')
      GROUP  BY t.id
      ORDER  BY entry_count DESC
      LIMIT  10
    `).all(from, to);
  }

  return {
    year,
    month,
    entryCount: entries.length,
    topThemes,
    entries,
  };
}

// ── Period comparison ─────────────────────────────────────────────────────────

/**
 * Compare the most active themes between two arbitrary date periods.
 *
 * Each period is defined by ISO date strings [from, to) (exclusive end).
 *
 * Returns:
 *  {
 *    period1: { from, to, themes: [{ id, display_name, entryCount }] },
 *    period2: { from, to, themes: [{ id, display_name, entryCount }] },
 *    gained:  themes present in period2 but not in period1 (new or returned)
 *    lost:    themes present in period1 but not in period2 (faded or dropped)
 *    common:  themes present in both periods
 *  }
 *
 * @param {string} from1
 * @param {string} to1
 * @param {string} from2
 * @param {string} to2
 * @returns {Promise<object>}
 */
async function comparePeriods(from1, to1, from2, to2) {
  const db = await openDb();

  function queryThemes(from, to) {
    return db.prepare(`
      SELECT t.id,
             COALESCE(t.user_name, t.name) AS display_name,
             COUNT(te.entry_id)            AS entry_count
      FROM   theme_entries te
      JOIN   themes t ON t.id = te.theme_id
      JOIN   entries e ON e.id = te.entry_id
      WHERE  DATE(e.created_at) >= DATE(?)
        AND  DATE(e.created_at) <  DATE(?)
      GROUP  BY t.id
      ORDER  BY entry_count DESC
      LIMIT  20
    `).all(from, to);
  }

  const themes1 = queryThemes(from1, to1);
  const themes2 = queryThemes(from2, to2);

  const ids1 = new Set(themes1.map((t) => t.id));
  const ids2 = new Set(themes2.map((t) => t.id));

  const gained = themes2.filter((t) => !ids1.has(t.id));
  const lost   = themes1.filter((t) => !ids2.has(t.id));
  const common = themes1.filter((t) => ids2.has(t.id));

  return {
    period1: { from: from1, to: to1, themes: themes1 },
    period2: { from: from2, to: to2, themes: themes2 },
    gained,
    lost,
    common,
  };
}

// ── Abandoned ideas ───────────────────────────────────────────────────────────

/**
 * Return entries that look like abandoned ideas:
 *  - category is 'Idea', 'Question', or 'Decision' (user or LLM)
 *  - created more than `olderThanDays` days ago
 *  - belong only to themes whose last activity was also more than `olderThanDays` ago,
 *    OR belong to no theme at all
 *
 * @param {number} [olderThanDays=30]
 * @param {number} [limit=50]
 * @returns {Promise<{ id: string, content: string, created_at: string, category: string }[]>}
 */
async function getAbandonedIdeas(olderThanDays = 30, limit = 50) {
  const db = await openDb();

  const rows = db.prepare(`
    SELECT e.id,
           e.content,
           e.created_at,
           COALESCE(e.user_category, e.category) AS category
    FROM   entries e
    WHERE  COALESCE(e.user_category, e.category) IN ('Idea', 'Question', 'Decision')
      AND  julianday('now') - julianday(e.created_at) > ?
      AND  e.id NOT IN (
             -- exclude entries that belong to a theme with recent activity (<= olderThanDays)
             SELECT te.entry_id
             FROM   theme_entries te
             JOIN   (
               SELECT theme_id, MAX(e2.created_at) AS last_active
               FROM   theme_entries te2
               JOIN   entries e2 ON e2.id = te2.entry_id
               GROUP  BY theme_id
             ) la ON la.theme_id = te.theme_id
             WHERE  julianday('now') - julianday(la.last_active) <= ?
           )
    ORDER  BY e.created_at ASC
    LIMIT  ?
  `).all(olderThanDays, olderThanDays, limit);

  return rows;
}

// ── Available months ──────────────────────────────────────────────────────────

/**
 * Return all year-month pairs for which there is at least one entry.
 * Ordered newest-first.
 * @returns {Promise<{ year: number, month: number, count: number }[]>}
 */
async function listActiveMonths() {
  const db = await openDb();
  const rows = db.prepare(`
    SELECT strftime('%Y', created_at) AS year,
           strftime('%m', created_at) AS month,
           COUNT(*)                   AS count
    FROM   entries
    GROUP  BY year, month
    ORDER  BY year DESC, month DESC
  `).all();
  return rows.map((r) => ({
    year:  parseInt(r.year, 10),
    month: parseInt(r.month, 10),
    count: r.count,
  }));
}

module.exports = { getMonthSnapshot, comparePeriods, getAbandonedIdeas, listActiveMonths };
