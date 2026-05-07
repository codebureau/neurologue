'use strict';

const { openDb } = require('./connection');

/**
 * Full-text search over entry content using SQLite LIKE.
 * Case-insensitive. Returns entries whose content contains the query string.
 *
 * @param {string} query
 * @param {{ limit?: number, offset?: number }} options
 * @returns {Promise<object[]>}
 */
async function searchEntriesText(query, { limit = 50, offset = 0 } = {}) {
  const db = await openDb();
  const pattern = `%${query}%`;
  const entries = db
    .prepare(`
      SELECT * FROM entries
      WHERE content LIKE ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(pattern, limit, offset);
  return _enrichWithTags(db, entries);
}

/**
 * List entries that belong to a given tag name.
 *
 * @param {string} tagName
 * @param {{ limit?: number, offset?: number }} options
 * @returns {Promise<object[]>}
 */
async function listEntriesByTag(tagName, { limit = 100, offset = 0 } = {}) {
  const db = await openDb();
  const entries = db
    .prepare(`
      SELECT e.* FROM entries e
      INNER JOIN entry_tags et ON et.entry_id = e.id
      INNER JOIN tags t ON t.id = et.tag_id
      WHERE t.name = ?
      ORDER BY e.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(tagName.trim().toLowerCase(), limit, offset);
  return _enrichWithTags(db, entries);
}

/**
 * Get a single entry with its tags.
 * Returns { ...entry, tags: [{ id, name }] } or undefined.
 *
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getEntryWithTags(id) {
  const db = await openDb();
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) return undefined;

  const tags = db
    .prepare(`
      SELECT t.id, t.name FROM tags t
      INNER JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id = ?
      ORDER BY t.name ASC
    `)
    .all(id);

  return { ...entry, tags };
}

/**
 * Attach tags to an array of entries using a single batch query.
 * Returns a new array where each entry has a `tags` array.
 *
 * @param {object} db - open db connection
 * @param {object[]} entries
 * @returns {object[]}
 */
function _enrichWithTags(db, entries) {
  if (!entries.length) return entries;
  const ids = entries.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`
      SELECT et.entry_id, t.id, t.name
      FROM tags t
      INNER JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id IN (${placeholders})
      ORDER BY t.name ASC
    `)
    .all(...ids);

  const byEntry = {};
  for (const row of rows) {
    if (!byEntry[row.entry_id]) byEntry[row.entry_id] = [];
    byEntry[row.entry_id].push({ id: row.id, name: row.name });
  }
  return entries.map((e) => ({ ...e, tags: byEntry[e.id] || [] }));
}

/**
 * List all entries (newest first) with their tags.
 *
 * @param {{ limit?: number, offset?: number }} options
 * @returns {Promise<object[]>}
 */
async function listEntriesWithTags({ limit = 50, offset = 0 } = {}) {
  const db = await openDb();
  const entries = db
    .prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
  return _enrichWithTags(db, entries);
}

module.exports = { searchEntriesText, listEntriesByTag, getEntryWithTags, listEntriesWithTags };
