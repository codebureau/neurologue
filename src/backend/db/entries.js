'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

/**
 * Create a new entry.
 * @param {{ content: string, source?: string, type?: string, metadata?: object }} data
 * @returns {Promise<object>}
 */
async function createEntry({ content, source = 'manual', type = 'note', metadata = {} }) {
  const db = await openDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO entries (id, content, source, type, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, content, source, type, JSON.stringify(metadata));
  return getEntryById(id);
}

/**
 * Get a single entry by ID.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getEntryById(id) {
  const db = await openDb();
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

/**
 * Get all entries, newest first.
 * @param {{ limit?: number, offset?: number }} options
 * @returns {Promise<object[]>}
 */
async function listEntries({ limit = 100, offset = 0 } = {}) {
  const db = await openDb();
  return db
    .prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

/**
 * Delete an entry by ID.
 * @param {string} id
 */
async function deleteEntry(id) {
  const db = await openDb();
  db.transaction(() => {
    db.prepare('DELETE FROM entry_revisions WHERE entry_id = ?').run(id);
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  })();
}

/**
 * Update the content of an entry, preserving revision history.
 * - If the entry has no original_content yet, the current content is saved there first.
 * - A new row is inserted into entry_revisions for the outgoing content.
 * - The entry's content and edited_at are updated.
 * @param {string} id
 * @param {string} newContent
 * @returns {Promise<object|undefined>}
 */
async function updateEntry(id, newContent) {
  const db = await openDb();
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!entry) return undefined;

  const revisionId = randomUUID();

  db.transaction(() => {
    // Preserve the very first version inline if this is the first edit
    if (!entry.original_content) {
      db.prepare('UPDATE entries SET original_content = ? WHERE id = ?').run(entry.content, id);
    }

    // Record the outgoing content as a revision
    db.prepare(`
      INSERT INTO entry_revisions (id, entry_id, content) VALUES (?, ?, ?)
    `).run(revisionId, id, entry.content);

    // Write the new content
    db.prepare(`
      UPDATE entries SET content = ?, edited_at = datetime('now') WHERE id = ?
    `).run(newContent, id);
  })();

  return getEntryById(id);
}

/**
 * Get the revision history for an entry, newest first.
 * @param {string} id
 * @returns {Promise<object[]>}
 */
async function getEntryRevisions(id) {
  const db = await openDb();
  return db
    .prepare('SELECT * FROM entry_revisions WHERE entry_id = ? ORDER BY rowid DESC')
    .all(id);
}

module.exports = { createEntry, getEntryById, listEntries, deleteEntry, updateEntry, getEntryRevisions };
