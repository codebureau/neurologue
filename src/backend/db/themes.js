'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

/**
 * Create or update a theme.
 * @param {{ id?: string, name: string, description?: string }} data
 * @returns {Promise<object>}
 */
async function upsertTheme({ id = randomUUID(), name, description = '' }) {
  const db = await openDb();
  db.prepare(`
    INSERT INTO themes (id, name, description) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
  `).run(id, name, description);
  return getThemeById(id);
}

/**
 * Get a single theme by ID.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getThemeById(id) {
  const db = await openDb();
  return db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
}

/**
 * List all themes.
 * @returns {Promise<object[]>}
 */
async function listThemes() {
  const db = await openDb();
  return db.prepare('SELECT * FROM themes ORDER BY name ASC').all();
}

/**
 * Delete a theme by ID.
 * @param {string} id
 */
async function deleteTheme(id) {
  const db = await openDb();
  db.prepare('DELETE FROM themes WHERE id = ?').run(id);
}

/**
 * Set the entries for a theme (replaces existing assignments).
 * @param {string} themeId
 * @param {{ entryId: string, score: number }[]} entries
 */
async function setThemeEntries(themeId, entries) {
  const db = await openDb();
  const replace = db.transaction((rows) => {
    db.prepare('DELETE FROM theme_entries WHERE theme_id = ?').run(themeId);
    const insert = db.prepare(
      'INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)'
    );
    for (const { entryId, score } of rows) {
      insert.run(themeId, entryId, score);
    }
  });
  replace(entries);
}

/**
 * Get all entries for a theme, ordered by score descending.
 * @param {string} themeId
 * @returns {Promise<{ entry_id: string, score: number }[]>}
 */
async function getEntriesForTheme(themeId) {
  const db = await openDb();
  return db.prepare(`
    SELECT entry_id, score
    FROM theme_entries
    WHERE theme_id = ?
    ORDER BY score DESC
  `).all(themeId);
}

module.exports = {
  upsertTheme,
  getThemeById,
  listThemes,
  deleteTheme,
  setThemeEntries,
  getEntriesForTheme,
};
