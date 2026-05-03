'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-emb-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;
  jest.resetModules();
  const { runMigrations } = require('../../../src/db/migrate');
  await runMigrations();
});

afterEach(() => {
  try {
    const { closeDb } = require('../../../src/backend/db/connection');
    closeDb();
  } catch { /* not loaded */ }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.NEUROLOGUE_DATA_PATH;
});

function makeVector(size = 384, fill = 0.5) {
  return new Float32Array(size).fill(fill);
}

async function makeEntry(content = 'embedding test') {
  const { createEntry } = require('../../../src/backend/db/entries');
  return createEntry({ content });
}

describe('upsertEmbedding / getEmbedding', () => {
  test('stores and retrieves a vector', async () => {
    const { upsertEmbedding, getEmbedding } = require('../../../src/backend/db/embeddings');
    const entry = await makeEntry();
    const vec = makeVector(384, 0.25);
    await upsertEmbedding(entry.id, vec, 'nomic-embed-text');
    const result = await getEmbedding(entry.id);
    expect(result).toBeDefined();
    expect(result.entry_id).toBe(entry.id);
    expect(result.model_name).toBe('nomic-embed-text');
    expect(result.vector).toBeInstanceOf(Float32Array);
    expect(result.vector.length).toBe(384);
    expect(result.vector[0]).toBeCloseTo(0.25, 5);
  });

  test('overwrites an existing embedding on conflict', async () => {
    const { upsertEmbedding, getEmbedding } = require('../../../src/backend/db/embeddings');
    const entry = await makeEntry();
    await upsertEmbedding(entry.id, makeVector(384, 0.1), 'nomic-embed-text');
    await upsertEmbedding(entry.id, makeVector(384, 0.9), 'nomic-embed-text');
    const result = await getEmbedding(entry.id);
    expect(result.vector[0]).toBeCloseTo(0.9, 5);
  });

  test('returns undefined for unknown entry id', async () => {
    const { getEmbedding } = require('../../../src/backend/db/embeddings');
    const result = await getEmbedding('00000000-0000-0000-0000-000000000000');
    expect(result).toBeUndefined();
  });
});

describe('listEntriesWithoutEmbedding', () => {
  test('returns ids of entries missing an embedding', async () => {
    const { upsertEmbedding, listEntriesWithoutEmbedding } = require('../../../src/backend/db/embeddings');
    const e1 = await makeEntry('needs embedding');
    const e2 = await makeEntry('already has embedding');
    await upsertEmbedding(e2.id, makeVector(), 'nomic-embed-text');
    const pending = await listEntriesWithoutEmbedding();
    expect(pending).toContain(e1.id);
    expect(pending).not.toContain(e2.id);
  });

  test('returns empty array when all entries have embeddings', async () => {
    const { upsertEmbedding, listEntriesWithoutEmbedding } = require('../../../src/backend/db/embeddings');
    const entry = await makeEntry();
    await upsertEmbedding(entry.id, makeVector(), 'nomic-embed-text');
    expect(await listEntriesWithoutEmbedding()).toEqual([]);
  });
});

describe('deleteEmbedding', () => {
  test('removes the embedding', async () => {
    const { upsertEmbedding, deleteEmbedding, getEmbedding } = require('../../../src/backend/db/embeddings');
    const entry = await makeEntry();
    await upsertEmbedding(entry.id, makeVector(), 'nomic-embed-text');
    await deleteEmbedding(entry.id);
    expect(await getEmbedding(entry.id)).toBeUndefined();
  });
});
