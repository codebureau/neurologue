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

module.exports = { upsertTag, listTags, getTagsForEntry, setTagsForEntry };
