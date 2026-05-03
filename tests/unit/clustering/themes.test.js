'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-clustering-'));
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

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeEntryWithEmbedding(content, vector) {
  const { createEntry } = require('../../../src/backend/db/entries');
  const { upsertEmbedding } = require('../../../src/backend/db/embeddings');
  const entry = await createEntry({ content });
  await upsertEmbedding(entry.id, vector, 'test-model');
  return entry;
}

function vec(dim, seed) {
  // Simple deterministic vector generator
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed * (i + 1));
  return v;
}

// ── runClustering ──────────────────────────────────────────────────────────

describe('runClustering', () => {
  // We mock isOllamaAvailable to avoid requiring Ollama in tests
  beforeEach(() => {
    jest.mock('../../../src/worker/ollama', () => ({
      isOllamaAvailable: jest.fn().mockResolvedValue(false),
      generateEmbedding: jest.fn(),
    }));
  });

  test('skips when fewer than 4 entries have embeddings', async () => {
    const { runClustering } = require('../../../src/backend/clustering/themes');
    await makeEntryWithEmbedding('entry one', vec(4, 1));
    await makeEntryWithEmbedding('entry two', vec(4, 2));

    const result = await runClustering();
    expect(result.skipped).toBe(true);
    expect(result.themes).toBe(0);
  });

  test('creates themes from clustered entries', async () => {
    const { runClustering } = require('../../../src/backend/clustering/themes');
    const { listThemes } = require('../../../src/backend/db/themes');

    // Create 8 entries with embeddings (two tight clusters in 4D)
    const cluster0 = [1, 1.01, 0.99, 1.02, 0.98, 1.005, 1.015, 0.995];
    const cluster1 = [5, 5.01, 4.99, 5.02, 4.98, 5.005, 5.015, 4.995];
    for (let i = 0; i < 4; i++) {
      await makeEntryWithEmbedding(`note about alpha ${i}`, new Float32Array([cluster0[i], 0, 0, 0]));
      await makeEntryWithEmbedding(`note about beta ${i}`, new Float32Array([cluster1[i], 10, 10, 10]));
    }

    const result = await runClustering();
    expect(result.skipped).toBe(false);
    expect(result.themes).toBeGreaterThanOrEqual(1);

    const themes = await listThemes();
    expect(themes.length).toBeGreaterThanOrEqual(1);
    themes.forEach((t) => {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
    });
  });

  test('assigns all entries to a theme', async () => {
    const { runClustering } = require('../../../src/backend/clustering/themes');
    const { getEntriesForTheme, listThemes } = require('../../../src/backend/db/themes');

    const entries = [];
    for (let i = 0; i < 6; i++) {
      const e = await makeEntryWithEmbedding(`entry ${i}`, vec(4, i));
      entries.push(e);
    }

    await runClustering();

    const themes = await listThemes();
    let totalAssigned = 0;
    for (const t of themes) {
      const members = await getEntriesForTheme(t.id);
      totalAssigned += members.length;
    }
    expect(totalAssigned).toBe(entries.length);
  });

  test('is idempotent — running twice does not duplicate themes', async () => {
    const { runClustering } = require('../../../src/backend/clustering/themes');
    const { listThemes } = require('../../../src/backend/db/themes');

    for (let i = 0; i < 6; i++) {
      await makeEntryWithEmbedding(`note ${i}`, vec(4, i + 10));
    }

    await runClustering();
    const countAfterFirst = (await listThemes()).length;

    await runClustering();
    const countAfterSecond = (await listThemes()).length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
