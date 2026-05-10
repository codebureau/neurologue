'use strict';

const lancedb = require('@lancedb/lancedb');
const config = require('../../config');

let _db = null;
let _table = null;

const TABLE_NAME = 'entry_embeddings';

/**
 * Initialise LanceDB. Creates the table if it does not exist.
 * Call once at startup before using other functions.
 */
async function initVectorStore() {
  _db = await lancedb.connect(config.vectorStore.path);

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

  const results = await _table
    .search(Array.from(queryVector))
    .limit(topN)
    .execute();

  return results;
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

module.exports = { initVectorStore, upsertVector, searchNearest, deleteVector, clearAllVectors };
