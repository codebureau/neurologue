'use strict';

const { openDb } = require('./connection');

/**
 * Write (upsert) entry signals. Replaces existing row for the same entry_id.
 *
 * @param {{
 *   entry_id: string,
 *   theme_id?: string|null,
 *   length_tokens: number,
 *   sentiment_score: number,
 *   emotional_intensity: number,
 *   obligation_flag: boolean,
 *   motivation_flag: boolean,
 *   value_reference_flag: boolean,
 *   open_loop_flag: boolean,
 * }} signals
 * @returns {object} The inserted/replaced row
 */
async function upsertEntrySignals(signals) {
  const db = await openDb();
  db.prepare(`
    INSERT INTO entry_signals
      (entry_id, theme_id, length_tokens, sentiment_score, emotional_intensity,
       obligation_flag, motivation_flag, value_reference_flag, open_loop_flag, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entry_id) DO UPDATE SET
      theme_id             = excluded.theme_id,
      length_tokens        = excluded.length_tokens,
      sentiment_score      = excluded.sentiment_score,
      emotional_intensity  = excluded.emotional_intensity,
      obligation_flag      = excluded.obligation_flag,
      motivation_flag      = excluded.motivation_flag,
      value_reference_flag = excluded.value_reference_flag,
      open_loop_flag       = excluded.open_loop_flag,
      computed_at          = excluded.computed_at
  `).run(
    signals.entry_id,
    signals.theme_id      ?? null,
    signals.length_tokens ?? 0,
    signals.sentiment_score      ?? 0,
    signals.emotional_intensity  ?? 0,
    signals.obligation_flag      ? 1 : 0,
    signals.motivation_flag      ? 1 : 0,
    signals.value_reference_flag ? 1 : 0,
    signals.open_loop_flag       ? 1 : 0,
  );
  return db.prepare('SELECT * FROM entry_signals WHERE entry_id = ?').get(signals.entry_id);
}

/**
 * Get signals for a single entry.
 * @param {string} entryId
 * @returns {object|undefined}
 */
async function getEntrySignals(entryId) {
  const db = await openDb();
  return db.prepare('SELECT * FROM entry_signals WHERE entry_id = ?').get(entryId);
}

/**
 * Get all signals for entries belonging to a theme.
 * @param {string} themeId
 * @returns {object[]}
 */
async function getSignalsByTheme(themeId) {
  const db = await openDb();
  return db.prepare('SELECT * FROM entry_signals WHERE theme_id = ? ORDER BY computed_at DESC').all(themeId);
}

/**
 * List entry IDs that have no signals computed yet.
 * @param {number} limit
 * @returns {string[]}
 */
async function listEntriesWithoutSignals(limit = 50) {
  const db = await openDb();
  return db.prepare(`
    SELECT e.id FROM entries e
    LEFT JOIN entry_signals es ON es.entry_id = e.id
    WHERE es.entry_id IS NULL
    ORDER BY e.created_at DESC
    LIMIT ?
  `).all(limit).map((r) => r.id);
}

module.exports = {
  upsertEntrySignals,
  getEntrySignals,
  getSignalsByTheme,
  listEntriesWithoutSignals,
};
