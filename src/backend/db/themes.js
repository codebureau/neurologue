'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

/**
 * Create or update a theme.
 * When updating, `name` is only written when the theme has no user-set name.
 * `description` is always updated (LLM re-generates on each cluster run).
 * @param {{ id?: string, name: string, description?: string }} data
 * @returns {Promise<object>}
 */
async function upsertTheme({ id = randomUUID(), name, description = '' }) {
  const db = await openDb();
  db.prepare(`
    INSERT INTO themes (id, name, description) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name        = CASE WHEN themes.user_name IS NULL THEN excluded.name ELSE themes.name END,
      description = excluded.description
  `).run(id, name, description);
  return getThemeById(id);
}

/**
 * Set a user-chosen name for a theme.
 * This name takes precedence over the LLM-generated name and is preserved
 * across re-clustering runs.
 * @param {string} id
 * @param {string} newName
 * @returns {Promise<object>}
 */
async function renameTheme(id, newName) {
  const db = await openDb();
  db.prepare('UPDATE themes SET user_name = ? WHERE id = ?').run(newName.trim(), id);
  return getThemeById(id);
}

/**
 * Get a single theme by ID, including its member entries.
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
async function getThemeById(id) {
  const db = await openDb();
  const theme = db.prepare(`
    SELECT t.*,
           COALESCE(t.user_name, t.name) AS display_name,
           COUNT(te.entry_id)            AS entry_count
    FROM themes t
    LEFT JOIN theme_entries te ON te.theme_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `).get(id);
  if (!theme) return undefined;

  theme.entries = db.prepare(`
    SELECT e.id, e.content, e.created_at, te.score
    FROM theme_entries te
    JOIN entries e ON e.id = te.entry_id
    WHERE te.theme_id = ?
    ORDER BY te.score DESC
  `).all(id);

  return theme;
}

/**
 * List all themes with entry counts.
 * The `display_name` field resolves to `user_name` when set, otherwise `name`.
 * @returns {Promise<object[]>}
 */
async function listThemes() {
  const db = await openDb();
  return db.prepare(`
    SELECT t.*,
           COALESCE(t.user_name, t.name) AS display_name,
           COUNT(te.entry_id)            AS entry_count
    FROM themes t
    LEFT JOIN theme_entries te ON te.theme_id = t.id
    GROUP BY t.id
    ORDER BY entry_count DESC, display_name ASC
  `).all();
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
  renameTheme,
  getThemeById,
  listThemes,
  deleteTheme,
  setThemeEntries,
  getEntriesForTheme,
};
