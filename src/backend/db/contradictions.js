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
 * Check whether a pair has already been examined — either a contradiction was
 * found (contradictions table) or it was checked and found clean (checked_pairs).
 * Uses canonical ordering.
 * @param {string} aId
 * @param {string} bId
 * @returns {Promise<boolean>}
 */
async function pairExists(aId, bId) {
  const [a, b] = _canonical(aId, bId);
  const db = await openDb();
  const inContradictions = db
    .prepare('SELECT id FROM contradictions WHERE entry_a_id = ? AND entry_b_id = ?')
    .get(a, b);
  if (inContradictions) return true;
  const inChecked = db
    .prepare('SELECT 1 FROM checked_pairs WHERE entry_a_id = ? AND entry_b_id = ?')
    .get(a, b);
  return !!inChecked;
}

/**
 * Record that a pair was examined and found NOT to be a contradiction.
 * Subsequent scans (and the reverse-order check in the same scan) will skip it.
 * @param {string} aId
 * @param {string} bId
 */
async function recordCheckedPair(aId, bId) {
  const [a, b] = _canonical(aId, bId);
  const db = await openDb();
  db.prepare(`
    INSERT OR IGNORE INTO checked_pairs (entry_a_id, entry_b_id)
    VALUES (?, ?)
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
