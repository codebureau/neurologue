'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

// Canonical ordering: always store the lexicographically smaller ID as entry_a_id.
// This lets the UNIQUE(entry_a_id, entry_b_id) constraint catch both orderings.
function _canonical(aId, bId) {
  return aId < bId ? [aId, bId] : [bId, aId];
}

const _JOIN = `
  SELECT c.*,
         ea.content    AS entry_a_content,
         ea.created_at AS entry_a_created_at,
         eb.content    AS entry_b_content,
         eb.created_at AS entry_b_created_at,
         COALESCE(t.user_name, t.name) AS theme_name
  FROM contradictions c
  JOIN entries ea ON ea.id = c.entry_a_id
  JOIN entries eb ON eb.id = c.entry_b_id
  LEFT JOIN themes t ON t.id = c.theme_id
`;

/**
 * Create a contradiction record for a pair of entries.
 * Uses INSERT OR IGNORE so a duplicate pair is silently skipped.
 * @param {{ entry_a_id: string, entry_b_id: string, theme_id?: string|null }} data
 * @returns {Promise<string>} the (possibly pre-existing) contradiction ID
 */
async function createContradiction({ entry_a_id, entry_b_id, theme_id = null }) {
  const [a, b] = _canonical(entry_a_id, entry_b_id);
  const db = await openDb();
  const id = randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO contradictions (id, entry_a_id, entry_b_id, theme_id)
    VALUES (?, ?, ?, ?)
  `).run(id, a, b, theme_id);
  return id;
}

/**
 * List contradictions, optionally filtered by status.
 * @param {{ status?: 'active'|'resolved'|'dismissed'|'all' }} opts
 * @returns {Promise<object[]>}
 */
async function listContradictions({ status = 'active' } = {}) {
  const db = await openDb();
  if (status === 'all') {
    return db.prepare(_JOIN + ' ORDER BY c.detected_at DESC').all();
  }
  return db.prepare(_JOIN + ' WHERE c.status = ? ORDER BY c.detected_at DESC').all(status);
}

/**
 * Mark a contradiction as resolved.
 * @param {string} id
 * @param {string} [notes]
 */
async function resolveContradiction(id, notes = '') {
  const db = await openDb();
  db.prepare(`
    UPDATE contradictions
    SET status = 'resolved', resolution_notes = ?, resolved_at = datetime('now')
    WHERE id = ?
  `).run(notes.trim() || null, id);
}

/**
 * Dismiss a contradiction (not a real conflict).
 * @param {string} id
 */
async function dismissContradiction(id) {
  const db = await openDb();
  db.prepare(`UPDATE contradictions SET status = 'dismissed' WHERE id = ?`).run(id);
}

/**
 * Check whether a pair has already been examined and the result is still fresh.
 *
 * A checked_pairs row is considered fresh only when it was recorded AFTER both
 * entries were last edited. If either entry has been updated since the pair was
 * checked, the row is treated as stale and the pair will be re-examined.
 *
 * If the pair produced a contradiction it is always considered "known" regardless
 * of edits (the user can dismiss/resolve it manually).
 *
 * @param {string} aId
 * @param {string} bId
 * @returns {Promise<boolean>}
 */
async function pairExists(aId, bId) {
  const [a, b] = _canonical(aId, bId);
  const db = await openDb();

  // A confirmed contradiction always counts, regardless of edits.
  const inContradictions = db
    .prepare('SELECT id FROM contradictions WHERE entry_a_id = ? AND entry_b_id = ?')
    .get(a, b);
  if (inContradictions) return true;

  // A clean-pair cache hit is only valid when checked_at is newer than both
  // entries' edited_at timestamps. If either entry changed, treat as unseen.
  const fresh = db.prepare(`
    SELECT 1 FROM checked_pairs cp
    JOIN entries ea ON ea.id = cp.entry_a_id
    JOIN entries eb ON eb.id = cp.entry_b_id
    WHERE cp.entry_a_id = ? AND cp.entry_b_id = ?
      AND cp.checked_at > COALESCE(ea.edited_at, ea.created_at)
      AND cp.checked_at > COALESCE(eb.edited_at, eb.created_at)
  `).get(a, b);
  return !!fresh;
}

/**
 * Record that a pair was examined and found NOT to be a contradiction.
 * The checked_at timestamp is used by pairExists to determine freshness;
 * no manual invalidation is needed when entries are edited.
 * @param {string} aId
 * @param {string} bId
 */
async function recordCheckedPair(aId, bId) {
  const [a, b] = _canonical(aId, bId);
  const db = await openDb();
  db.prepare(`
    INSERT OR REPLACE INTO checked_pairs (entry_a_id, entry_b_id, checked_at)
    VALUES (?, ?, datetime('now'))
  `).run(a, b);
}

module.exports = {
  createContradiction,
  listContradictions,
  resolveContradiction,
  dismissContradiction,
  pairExists,
  recordCheckedPair,
};
