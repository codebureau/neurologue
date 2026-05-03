'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
let exportDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-export-'));
  exportDir = path.join(tmpDir, 'export-out');
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

async function seedData() {
  const { createEntry } = require('../../../src/backend/db/entries');
  const { setTagsForEntry } = require('../../../src/backend/db/tags');
  const { upsertEmbedding } = require('../../../src/backend/db/embeddings');
  const { upsertTheme, setThemeEntries } = require('../../../src/backend/db/themes');

  const e1 = await createEntry({ content: 'First entry about ideas' });
  const e2 = await createEntry({ content: 'Second entry about memory' });
  await setTagsForEntry(e1.id, ['ideas']);
  await upsertEmbedding(e1.id, new Float32Array([0.1, 0.2, 0.3]), 'test-model');
  await upsertEmbedding(e2.id, new Float32Array([0.4, 0.5, 0.6]), 'test-model');

  const theme = await upsertTheme({ name: 'Test Theme', description: 'A summary' });
  await setThemeEntries(theme.id, [
    { entryId: e1.id, score: 0.9 },
    { entryId: e2.id, score: 0.7 },
  ]);

  return { e1, e2, theme };
}

// ── runExport ──────────────────────────────────────────────────────────────

describe('runExport', () => {
  test('creates output directory if it does not exist', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await runExport(exportDir);
    expect(fs.existsSync(exportDir)).toBe(true);
  });

  test('writes all expected files', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    await runExport(exportDir);
    const files = fs.readdirSync(exportDir);
    expect(files).toContain('entries.json');
    expect(files).toContain('entries.md');
    expect(files).toContain('themes.json');
    expect(files).toContain('themes.md');
    expect(files).toContain('embeddings.jsonl');
  });

  test('returns correct counts', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    const result = await runExport(exportDir);
    expect(result.entryCount).toBe(2);
    expect(result.themeCount).toBe(1);
    expect(result.embeddingCount).toBe(2);
  });

  test('entries.json contains valid JSON with correct entry count', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    await runExport(exportDir);
    const json = JSON.parse(fs.readFileSync(path.join(exportDir, 'entries.json'), 'utf8'));
    expect(json).toHaveLength(2);
    expect(json[0]).toHaveProperty('content');
    expect(json[0]).toHaveProperty('tags');
  });

  test('themes.json contains theme with entries', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    await runExport(exportDir);
    const json = JSON.parse(fs.readFileSync(path.join(exportDir, 'themes.json'), 'utf8'));
    expect(json).toHaveLength(1);
    expect(json[0].name).toBe('Test Theme');
    expect(json[0].summary).toBe('A summary');
    expect(json[0].entries).toHaveLength(2);
  });

  test('embeddings.jsonl has one line per embedding', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    await runExport(exportDir);
    const jsonl = fs.readFileSync(path.join(exportDir, 'embeddings.jsonl'), 'utf8');
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  test('skips embeddings.jsonl when includeEmbeddings=false', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    await seedData();
    const result = await runExport(exportDir, { includeEmbeddings: false });
    expect(fs.existsSync(path.join(exportDir, 'embeddings.jsonl'))).toBe(false);
    expect(result.embeddingCount).toBe(0);
    expect(result.files).not.toContain(path.join(exportDir, 'embeddings.jsonl'));
  });

  test('works with no data (empty DB)', async () => {
    const { runExport } = require('../../../src/backend/export/runner');
    const result = await runExport(exportDir);
    expect(result.entryCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(result.embeddingCount).toBe(0);
    expect(fs.existsSync(path.join(exportDir, 'entries.json'))).toBe(true);
  });
});
