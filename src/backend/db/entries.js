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
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
}

module.exports = { createEntry, getEntryById, listEntries, deleteEntry };
