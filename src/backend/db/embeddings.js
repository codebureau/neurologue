'use strict';

const { openDb } = require('./connection');

/**
 * Store or replace the embedding for an entry.
 * Vector is stored as a BLOB in SQLite as a compact fallback;
 * the authoritative vector store is LanceDB (see src/backend/vector/store.js).
 *
 * @param {string} entryId
 * @param {Float32Array} vector
 * @param {string} modelName
 */
async function upsertEmbedding(entryId, vector, modelName) {
  const db = await openDb();
  const buffer = Buffer.from(vector.buffer);
  db.prepare(`
    INSERT INTO embeddings (entry_id, vector, model_name) VALUES (?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET vector = excluded.vector, model_name = excluded.model_name
  `).run(entryId, buffer, modelName);
}

/**
 * Get the stored embedding for an entry.
 * Returns { entry_id, vector: Float32Array, model_name } or undefined.
 *
 * sql.js returns BLOB columns as Uint8Array; copy into a fresh buffer before
 * creating a Float32Array view to ensure correct byte alignment.
 *
 * @param {string} entryId
 * @returns {Promise<{ entry_id: string, vector: Float32Array, model_name: string }|undefined>}
 */
async function getEmbedding(entryId) {
  const db = await openDb();
  const row = db.prepare('SELECT * FROM embeddings WHERE entry_id = ?').get(entryId);
  if (!row) return undefined;
  const bytes = new Uint8Array(row.vector); // copy to own ArrayBuffer (aligns to offset 0)
  return {
    entry_id: row.entry_id,
    vector: new Float32Array(bytes.buffer),
    model_name: row.model_name,
  };
}

/**
 * List all entry IDs that do not yet have an embedding.
 * @returns {Promise<string[]>}
 */
async function listEntriesWithoutEmbedding() {
  const db = await openDb();
  return db
    .prepare(`
      SELECT e.id FROM entries e
      LEFT JOIN embeddings em ON em.entry_id = e.id
      WHERE em.entry_id IS NULL
    `)
    .all()
    .map((r) => r.id);
}

/**
 * Delete the embedding for an entry.
 * @param {string} entryId
 */
async function deleteEmbedding(entryId) {
  const db = await openDb();
  db.prepare('DELETE FROM embeddings WHERE entry_id = ?').run(entryId);
}

module.exports = { upsertEmbedding, getEmbedding, listEntriesWithoutEmbedding, deleteEmbedding };
