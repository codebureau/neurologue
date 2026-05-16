'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
let exportDir;

beforeEach(async () => {
  tmpDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-ccf-'));
  exportDir = path.join(tmpDir, 'ccf-out');
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

// ── Test helpers ────────────────────────────────────────────────────────────

async function seedData() {
  const { createEntry }       = require('../../../src/backend/db/entries');
  const { setTagsForEntry }   = require('../../../src/backend/db/tags');
  const { upsertEmbedding }   = require('../../../src/backend/db/embeddings');
  const { upsertTheme, setThemeEntries } = require('../../../src/backend/db/themes');

  const e1 = await createEntry({ content: 'First entry about ideas' });
  const e2 = await createEntry({ content: 'Second entry about memory' });
  await setTagsForEntry(e1.id, ['ideas', 'project:alpha']);
  await upsertEmbedding(e1.id, new Float32Array([0.1, 0.2, 0.3]), 'test-model');
  await upsertEmbedding(e2.id, new Float32Array([0.4, 0.5, 0.6]), 'test-model');

  const theme = await upsertTheme({ name: 'Test Theme', description: 'A test summary' });
  await setThemeEntries(theme.id, [
    { entryId: e1.id, score: 0.9 },
    { entryId: e2.id, score: 0.7 },
  ]);

  return { e1, e2, theme };
}

// ── exportCCF — folder structure ────────────────────────────────────────────

describe('exportCCF — folder structure', () => {
  test('creates output directory if it does not exist', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await exportCCF(exportDir);
    expect(fs.existsSync(exportDir)).toBe(true);
  });

  test('creates embeddings/ subdirectory', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await exportCCF(exportDir);
    expect(fs.existsSync(path.join(exportDir, 'embeddings'))).toBe(true);
  });

  test('writes all four required CCF files', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    expect(fs.existsSync(path.join(exportDir, 'entries.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(exportDir, 'themes.json'))).toBe(true);
    expect(fs.existsSync(path.join(exportDir, 'embeddings', 'entries.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(exportDir, 'metadata.json'))).toBe(true);
  });

  test('returns correct counts', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    const { e1, e2, theme } = await seedData();
    const result = await exportCCF(exportDir);
    expect(result.entryCount).toBe(2);
    expect(result.themeCount).toBe(1);
    expect(result.embeddingCount).toBe(2);
    expect(result.dir).toBe(exportDir);
  });

  test('returns embedding model and dimension', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    const result = await exportCCF(exportDir);
    expect(result.embeddingModel).toBe('test-model');
    expect(result.dimension).toBe(3);
  });
});

// ── exportCCF — entries.jsonl ───────────────────────────────────────────────

describe('exportCCF — entries.jsonl', () => {
  test('each line is valid JSON', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const lines = fs
      .readFileSync(path.join(exportDir, 'entries.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  test('each entry has required CCF fields', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const entries = fs
      .readFileSync(path.join(exportDir, 'entries.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    for (const e of entries) {
      expect(e).toHaveProperty('id');
      expect(e).toHaveProperty('created_at');
      expect(e).toHaveProperty('updated_at');
      expect(e).toHaveProperty('text');
      expect(e).toHaveProperty('source');
      expect(e.source).toMatchObject({ type: 'user', app: 'neurologue' });
      expect(e).toHaveProperty('domain', 'personal');
      expect(Array.isArray(e.tags)).toBe(true);
      expect(Array.isArray(e.theme_ids)).toBe(true);
      expect(Array.isArray(e.media_refs)).toBe(true);
      expect(e).toHaveProperty('metadata');
    }
  });

  test('tags are populated correctly', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    const { e1 } = await seedData();
    await exportCCF(exportDir);
    const entries = fs
      .readFileSync(path.join(exportDir, 'entries.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const exported = entries.find((e) => e.id === e1.id);
    expect(exported.tags).toEqual(expect.arrayContaining(['ideas', 'project:alpha']));
  });

  test('theme_ids are populated for entries belonging to a theme', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    const { e1, theme } = await seedData();
    await exportCCF(exportDir);
    const entries = fs
      .readFileSync(path.join(exportDir, 'entries.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const exported = entries.find((e) => e.id === e1.id);
    expect(exported.theme_ids).toContain(theme.id);
  });
});

// ── exportCCF — themes.json ─────────────────────────────────────────────────

describe('exportCCF — themes.json', () => {
  test('parses as a JSON array', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const themes = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'themes.json'), 'utf8'),
    );
    expect(Array.isArray(themes)).toBe(true);
    expect(themes.length).toBe(1);
  });

  test('each theme has required CCF fields', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const themes = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'themes.json'), 'utf8'),
    );
    for (const t of themes) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('summary');
      expect(Array.isArray(t.entry_ids)).toBe(true);
      expect(t).toHaveProperty('metrics');
      expect(t.metrics).toHaveProperty('entry_count');
    }
  });

  test('entry_ids are populated', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    const { e1, e2 } = await seedData();
    await exportCCF(exportDir);
    const themes = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'themes.json'), 'utf8'),
    );
    expect(themes[0].entry_ids).toEqual(expect.arrayContaining([e1.id, e2.id]));
    expect(themes[0].metrics.entry_count).toBe(2);
  });
});

// ── exportCCF — embeddings/entries.jsonl ───────────────────────────────────

describe('exportCCF — embeddings/entries.jsonl', () => {
  test('each line is valid JSON with required fields', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const lines = fs
      .readFileSync(path.join(exportDir, 'embeddings', 'entries.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      const emb = JSON.parse(line);
      expect(emb).toHaveProperty('entry_id');
      expect(emb).toHaveProperty('model');
      expect(Array.isArray(emb.vector)).toBe(true);
      expect(emb.vector.length).toBeGreaterThan(0);
    }
  });
});

// ── exportCCF — metadata.json ───────────────────────────────────────────────

describe('exportCCF — metadata.json', () => {
  test('has required top-level fields', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await seedData();
    await exportCCF(exportDir);
    const meta = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'metadata.json'), 'utf8'),
    );
    expect(meta).toHaveProperty('format_version', '1.0.0');
    expect(meta).toHaveProperty('exported_at');
    expect(meta).toHaveProperty('app');
    expect(meta.app).toMatchObject({ name: 'Neurologue' });
    expect(typeof meta.app.version).toBe('string');
    expect(meta).toHaveProperty('embedding');
    expect(meta).toHaveProperty('notes');
    expect(meta.notes.entry_count).toBe(2);
    expect(meta.notes.theme_count).toBe(1);
  });

  test('exported_at is a valid ISO 8601 date', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    await exportCCF(exportDir);
    const meta = JSON.parse(
      fs.readFileSync(path.join(exportDir, 'metadata.json'), 'utf8'),
    );
    expect(new Date(meta.exported_at).toISOString()).toBe(meta.exported_at);
  });
});

// ── exportCCF — empty corpus ────────────────────────────────────────────────

describe('exportCCF — empty corpus', () => {
  test('produces all four files with empty/null data', async () => {
    const { exportCCF } = require('../../../src/backend/export/ccf');
    const result = await exportCCF(exportDir);
    expect(result.entryCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(result.embeddingCount).toBe(0);
    expect(result.embeddingModel).toBeNull();
    // entries.jsonl should be empty string
    const entriesContent = fs.readFileSync(path.join(exportDir, 'entries.jsonl'), 'utf8');
    expect(entriesContent).toBe('');
    // themes.json should be empty array
    const themes = JSON.parse(fs.readFileSync(path.join(exportDir, 'themes.json'), 'utf8'));
    expect(themes).toEqual([]);
  });
});

// ── toCCFEntry — pure transform ─────────────────────────────────────────────

describe('toCCFEntry', () => {
  const { toCCFEntry } = require('../../../src/backend/export/ccf');

  const ENTRY = {
    id:         'abc123',
    content:    'A thought',
    created_at: '2026-01-01T10:00:00.000Z',
    edited_at:  '2026-01-02T12:00:00.000Z',
    tags:       [{ id: 't1', name: 'ideas' }],
  };

  test('maps required fields correctly', () => {
    const ccf = toCCFEntry(ENTRY, new Map());
    expect(ccf.id).toBe('abc123');
    expect(ccf.text).toBe('A thought');
    expect(ccf.created_at).toBe('2026-01-01T10:00:00.000Z');
    expect(ccf.updated_at).toBe('2026-01-02T12:00:00.000Z');
    expect(ccf.source).toMatchObject({ type: 'user', app: 'neurologue', external_id: null });
    expect(ccf.domain).toBe('personal');
    expect(ccf.tags).toEqual(['ideas']);
    expect(ccf.media_refs).toEqual([]);
  });

  test('uses created_at as updated_at when edited_at is absent', () => {
    const { toCCFEntry: fn } = require('../../../src/backend/export/ccf');
    const ccf = fn({ ...ENTRY, edited_at: null }, new Map());
    expect(ccf.updated_at).toBe(ENTRY.created_at);
  });

  test('populates theme_ids from the lookup map', () => {
    const map = new Map([['abc123', ['theme1', 'theme2']]]);
    const ccf = toCCFEntry(ENTRY, map);
    expect(ccf.theme_ids).toEqual(['theme1', 'theme2']);
  });

  test('theme_ids is empty when entry not in any theme', () => {
    const ccf = toCCFEntry(ENTRY, new Map());
    expect(ccf.theme_ids).toEqual([]);
  });
});

// ── toCCFTheme — pure transform ─────────────────────────────────────────────

describe('toCCFTheme', () => {
  const { toCCFTheme } = require('../../../src/backend/export/ccf');

  const THEME = {
    id:          'theme1',
    name:        'Ideas',
    display_name: 'Ideas (user)',
    description: 'All about ideas',
    created_at:  '2026-01-01T00:00:00.000Z',
    entries: [
      { entry_id: 'e1', score: 0.9, created_at: '2026-01-05T00:00:00.000Z' },
      { entry_id: 'e2', score: 0.8, created_at: '2026-01-10T00:00:00.000Z' },
    ],
  };

  test('maps required fields', () => {
    const ccf = toCCFTheme(THEME);
    expect(ccf.id).toBe('theme1');
    expect(ccf.name).toBe('Ideas (user)');
    expect(ccf.summary).toBe('All about ideas');
    expect(ccf.entry_ids).toEqual(['e1', 'e2']);
  });

  test('computes metrics correctly', () => {
    const ccf = toCCFTheme(THEME);
    expect(ccf.metrics.entry_count).toBe(2);
    expect(ccf.metrics.first_entry_at).toBe('2026-01-05T00:00:00.000Z');
    expect(ccf.metrics.last_entry_at).toBe('2026-01-10T00:00:00.000Z');
  });

  test('handles theme with no entries', () => {
    const ccf = toCCFTheme({ ...THEME, entries: [] });
    expect(ccf.entry_ids).toEqual([]);
    expect(ccf.metrics.entry_count).toBe(0);
    expect(ccf.metrics.first_entry_at).toBeNull();
    expect(ccf.metrics.last_entry_at).toBeNull();
  });

  test('falls back to name when display_name is absent', () => {
    const ccf = toCCFTheme({ ...THEME, display_name: undefined });
    expect(ccf.name).toBe('Ideas');
  });
});
