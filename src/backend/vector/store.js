'use strict';

const lancedb = require('@lancedb/lancedb');
const config = require('../../config');

let _db = null;
let _table = null;
let _storePathOverride = null;

/**
 * Override the vector store path used by initVectorStore().
 * @param {string|null} storePath
 */
function setStorePath(storePath) {
  _storePathOverride = storePath || null;
}

/**
 * Close the current vector store and reinitialise at a new path.
 * Used by portfolio switching.
 * @param {string} newPath
 */
async function switchVectorStore(newPath) {
  _db = null;
  _table = null;
  _storePathOverride = newPath;
  return initVectorStore();
}

const TABLE_NAME = 'entry_embeddings';

/**
 * Initialise LanceDB. Creates the table if it does not exist.
 * Call once at startup before using other functions.
 */
async function initVectorStore() {
  const storePath = _storePathOverride || config.vectorStore.path;
  _db = await lancedb.connect(storePath);

  const tableNames = await _db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    _table = await _db.openTable(TABLE_NAME);
  } else {
    // Create table with a placeholder row then delete it, to establish the schema.
    // Schema: entry_id (string), model_name (string), vector (fixed-size float32 list)
    _table = await _db.createTable(TABLE_NAME, [
      { entry_id: '__init__', model_name: '__init__', vector: new Array(768).fill(0) },
    ]);
    await _table.delete("entry_id = '__init__'");
  }
}

/**
 * Add or replace a vector for an entry.
 * @param {string} entryId
 * @param {number[]|Float32Array} vector
 * @param {string} modelName
 */
async function upsertVector(entryId, vector, modelName) {
  if (!_table) throw new Error('Vector store not initialised. Call initVectorStore() first.');

  // Delete existing row for this entry if present
  await _table.delete(`entry_id = '${entryId}'`);

  await _table.add([
    { entry_id: entryId, model_name: modelName, vector: Array.from(vector) },
  ]);
}

/**
 * Search for the nearest neighbours to a query vector.
 * @param {number[]|Float32Array} queryVector
 * @param {number} topN
 * @returns {Promise<{ entry_id: string, model_name: string, _distance: number }[]>}
 */
async function searchNearest(queryVector, topN = 10) {
  if (!_table) throw new Error('Vector store not initialised. Call initVectorStore() first.');

  const raw = await _table
    .search(Array.from(queryVector))
    .limit(topN)
    .execute();

  // LanceDB 0.17+ may return an Arrow Table rather than a plain array
  if (Array.isArray(raw)) return raw;
  if (typeof raw.toArray === 'function') return raw.toArray();
  return Array.from(raw);
}

/**
 * Delete the vector for a given entry.
 * @param {string} entryId
 */
async function deleteVector(entryId) {
  if (!_table) throw new Error('Vector store not initialised. Call initVectorStore() first.');
  await _table.delete(`entry_id = '${entryId}'`);
}

/**
 * Delete ALL vectors. Used to force a full reindex.
 */
async function clearAllVectors() {
  if (!_table) throw new Error('Vector store not initialised. Call initVectorStore() first.');
  await _table.delete('entry_id IS NOT NULL');
}

module.exports = { initVectorStore, upsertVector, searchNearest, deleteVector, clearAllVectors, setStorePath, switchVectorStore };
