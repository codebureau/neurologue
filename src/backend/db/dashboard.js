'use strict';

const { openDb } = require('./connection');

/**
 * Aggregate all signals needed for the Cognitive Dashboard in a single call.
 *
 * Returns:
 *  {
 *    totalEntries:       number,
 *    activeThemes:       [{ id, display_name, entry_count, last_active }]  (active last 7 d, max 8)
 *    emergingThemes:     [{ id, display_name, entry_count, created_at }]   (formed last 7 d, max 5)
 *    openLoopEntries:    [{ id, content, created_at }]                     (max 8)
 *    openLoopCount:      number,
 *    contradictionCount: number,
 *    recentCaptures:     [{ id, content, created_at, category }]           (max 6)
 *    thoughtDensity:     [{ day: 'YYYY-MM-DD', count: number }]            (last 14 days)
 *    weeklyEntryCount:   number,
 *  }
 */
async function getDashboardSummary() {
  const db = await openDb();

  const totalEntries = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;

  // All themes, with most recent entry date, oldest entry date, and total entry count
  const allThemes = db.prepare(`
    SELECT t.id,
           COALESCE(t.user_name, t.name) AS display_name,
           COUNT(te.entry_id)            AS entry_count,
           MAX(e.created_at)             AS last_active,
           MIN(e.created_at)             AS first_active
    FROM themes t
    LEFT JOIN theme_entries te ON te.theme_id = t.id
    LEFT JOIN entries e        ON e.id = te.entry_id
    GROUP BY t.id
    ORDER BY last_active DESC
  `).all();

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  // Active: had entry activity in the last 7 days
  const activeThemes = allThemes
    .filter((t) => t.last_active && t.last_active >= sevenDaysAgo)
    .slice(0, 8);

  // Emerging: all entries are from within the last 7 days (first entry is recent)
  const emergingThemes = allThemes
    .filter((t) => t.first_active && t.first_active >= sevenDaysAgo)
    .slice(0, 5);

  // Open loops from entry_signals
  const openLoopEntries = db.prepare(`
    SELECT e.id, e.content, e.created_at
    FROM entry_signals es
    JOIN entries e ON e.id = es.entry_id
    WHERE es.open_loop_flag = 1
    ORDER BY e.created_at DESC
    LIMIT 8
  `).all();

  const openLoopCount = db.prepare(
    'SELECT COUNT(*) AS n FROM entry_signals WHERE open_loop_flag = 1'
  ).get().n;

  const contradictionCount = db.prepare(
    "SELECT COUNT(*) AS n FROM contradictions WHERE status = 'active'"
  ).get().n;

  const recentCaptures = db.prepare(`
    SELECT id, content, created_at, COALESCE(user_category, category) AS category
    FROM entries
    ORDER BY created_at DESC
    LIMIT 6
  `).all();

  const thoughtDensity = db.prepare(`
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM entries
    WHERE created_at >= DATE('now', '-14 days')
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `).all();

  const weeklyEntryCount = db.prepare(`
    SELECT COUNT(*) AS n FROM entries WHERE created_at >= DATE('now', '-7 days')
  `).get().n;

  return {
    totalEntries,
    activeThemes,
    emergingThemes,
    openLoopEntries,
    openLoopCount,
    contradictionCount,
    recentCaptures,
    thoughtDensity,
    weeklyEntryCount,
  };
}

module.exports = { getDashboardSummary };
