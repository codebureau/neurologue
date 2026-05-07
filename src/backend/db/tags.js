'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

/**
 * Find or create a tag by name. Returns the tag row.
 * @param {string} name
 * @returns {Promise<{ id: string, name: string }>}
 */
async function upsertTag(name) {
  const db = await openDb();
  const normalised = name.trim().toLowerCase();
  const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(normalised);
  if (existing) return existing;

  const id = randomUUID();
  db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, normalised);
  return { id, name: normalised };
}

/**
 * List all tags.
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function listTags() {
  const db = await openDb();
  return db.prepare('SELECT * FROM tags ORDER BY name ASC').all();
}

/**
 * Get all tags for a given entry.
 * @param {string} entryId
 * @returns {Promise<{ id: string, name: string }[]>}
 */
async function getTagsForEntry(entryId) {
  const db = await openDb();
  return db.prepare(`
    SELECT t.id, t.name
    FROM tags t
    INNER JOIN entry_tags et ON et.tag_id = t.id
    WHERE et.entry_id = ?
    ORDER BY t.name ASC
  `).all(entryId);
}

/**
 * Associate a list of tag names with an entry.
 * Creates tags that do not yet exist.
 * Runs entirely inside a single transaction (db is already resolved before entering).
 * @param {string} entryId
 * @param {string[]} tagNames
 */
async function setTagsForEntry(entryId, tagNames) {
  const db = await openDb();

  // upsertTag is inlined here to keep the transaction callback synchronous
  const setAll = db.transaction((names) => {
    db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(entryId);
    for (const name of names) {
      const normalised = name.trim().toLowerCase();
      let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(normalised);
      if (!tag) {
        const id = randomUUID();
        db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(id, normalised);
        tag = { id };
      }
      db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(entryId, tag.id);
    }
  });

  setAll(tagNames.filter(Boolean));
}

/**
 * List all tags with entry counts, sorted by count desc then name asc.
 * @returns {Promise<{ id: string, name: string, count: number }[]>}
 */
async function listTagsWithCounts() {
  const db = await openDb();
  return db.prepare(`
    SELECT t.id, t.name, COUNT(et.entry_id) AS count
    FROM tags t
    LEFT JOIN entry_tags et ON et.tag_id = t.id
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all();
}

/**
 * Rename a tag. Fails if the normalised new name already exists on a different tag.
 * @param {string} id
 * @param {string} newName
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function renameTag(id, newName) {
  const db = await openDb();
  const normalised = newName.trim().toLowerCase();
  if (!normalised) return { ok: false, error: 'Name cannot be empty' };

  const collision = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(normalised, id);
  if (collision) return { ok: false, error: `Tag "${normalised}" already exists` };

  db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(normalised, id);
  return { ok: true };
}

/**
 * Delete a tag and all its entry associations.
 * @param {string} id
 * @returns {Promise<{ ok: boolean }>}
 */
async function deleteTag(id) {
  const db = await openDb();
  const doDelete = db.transaction(() => {
    db.prepare('DELETE FROM entry_tags WHERE tag_id = ?').run(id);
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  });
  doDelete();
  return { ok: true };
}

/**
 * Merge two tags: all entries with `removeId` get `keepId` applied, then `removeId` is deleted.
 * @param {string} removeId
 * @param {string} keepId
 * @returns {Promise<{ ok: boolean, affected: number }>}
 */
async function mergeTag(removeId, keepId) {
  const db = await openDb();
  const doMerge = db.transaction(() => {
    // Find all entries that have the tag being removed
    const affected = db.prepare('SELECT entry_id FROM entry_tags WHERE tag_id = ?').all(removeId);
    let count = 0;
    for (const { entry_id } of affected) {
      // Add keepId to the entry if not already present
      db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').run(entry_id, keepId);
      count++;
    }
    // Remove the source tag entirely
    db.prepare('DELETE FROM entry_tags WHERE tag_id = ?').run(removeId);
    db.prepare('DELETE FROM tags WHERE id = ?').run(removeId);
    return count;
  });
  const affected = doMerge();
  return { ok: true, affected };
}

// ── Similarity helpers (pure JS, no external deps) ─────────────────────────

function _normTagKey(name) {
  return name.replace(/[-_\s]+/g, '').toLowerCase();
}

function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return curr[n];
}

/**
 * Return pairs of tags that are likely duplicates/variants.
 * Each pair: { a: tag, b: tag, reason: 'format-variant'|'similar-spelling' }
 * Sorted by combined entry count desc.
 * @returns {Promise<{ a: object, b: object, reason: string }[]>}
 */
async function findSimilarTags() {
  const tags = await listTagsWithCounts();
  const pairs = [];

  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i], b = tags[j];

      // Format variant: same after stripping separators
      if (_normTagKey(a.name) === _normTagKey(b.name)) {
        pairs.push({ a, b, reason: 'format-variant' });
        continue;
      }

      // Spelling variant: small edit distance relative to tag length
      const minLen = Math.min(a.name.length, b.name.length);
      if (minLen >= 4) {
        const threshold = minLen >= 7 ? 2 : 1;
        if (_levenshtein(a.name, b.name) <= threshold) {
          pairs.push({ a, b, reason: 'similar-spelling' });
        }
      }
    }
  }

  // Sort: most-used pairs first
  return pairs.sort((x, y) => (y.a.count + y.b.count) - (x.a.count + x.b.count));
}

module.exports = { upsertTag, listTags, listTagsWithCounts, getTagsForEntry, setTagsForEntry, renameTag, deleteTag, mergeTag, findSimilarTags };
