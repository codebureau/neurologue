'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
let snapshotDir;

beforeEach(async () => {
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-ccf-import-'));
  snapshotDir = path.join(tmpDir, 'snapshot');
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

// ── CCF snapshot fixture builder ─────────────────────────────────────────────

function writeSnapshot(dir, {
  entries       = defaultEntries(),
  themes        = defaultThemes(),
  metadata      = defaultMetadata(),
  embeddings    = null,
} = {}) {
  fs.mkdirSync(path.join(dir, 'embeddings'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'entries.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
  fs.writeFileSync(path.join(dir, 'themes.json'),
    JSON.stringify(themes, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'metadata.json'),
    JSON.stringify(metadata, null, 2), 'utf8');
  if (embeddings) {
    fs.writeFileSync(path.join(dir, 'embeddings', 'entries.jsonl'),
      embeddings.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
  }
}

function defaultEntries() {
  return [
    { id: 'ccf-e1', created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-02T10:00:00Z', text: 'First imported entry', source: { type: 'user', app: 'neurologue', external_id: null }, domain: 'personal', tags: ['ideas', 'project:alpha'], theme_ids: ['ccf-t1'], media_refs: [], metadata: {} },
    { id: 'ccf-e2', created_at: '2026-01-05T12:00:00Z', updated_at: '2026-01-05T12:00:00Z', text: 'Second imported entry', source: { type: 'user', app: 'neurologue', external_id: null }, domain: 'personal', tags: [], theme_ids: ['ccf-t1'], media_refs: [], metadata: {} },
  ];
}

function defaultThemes() {
  return [
    { id: 'ccf-t1', name: 'Imported Theme', summary: 'A theme from the snapshot', entry_ids: ['ccf-e1', 'ccf-e2'], metrics: { entry_count: 2 }, metadata: {} },
  ];
}

function defaultMetadata() {
  return {
    format_version: '1.0.0',
    exported_at:    '2026-01-10T12:00:00.000Z',
    app:   { name: 'Neurologue', version: '0.5.0' },
    embedding: { model: 'test-model', dimension: 3 },
    notes: { entry_count: 2, theme_count: 1 },
    custom: {},
  };
}

function defaultEmbeddings() {
  return [
    { entry_id: 'ccf-e1', model: 'test-model', vector: [0.1, 0.2, 0.3] },
    { entry_id: 'ccf-e2', model: 'test-model', vector: [0.4, 0.5, 0.6] },
  ];
}

// ── importCCF — validation gate ──────────────────────────────────────────────

describe('importCCF — validation gate', () => {
  test('returns ok:false when snapshot is missing required files', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    fs.mkdirSync(snapshotDir, { recursive: true }); // empty folder
    const result = await importCCF(snapshotDir);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('does not write to DB when validation fails', async () => {
    const { importCCF }   = require('../../../src/backend/import/ccf-import');
    const { openDb }      = require('../../../src/backend/db/connection');
    fs.mkdirSync(snapshotDir, { recursive: true });
    await importCCF(snapshotDir);
    const db = await openDb();
    const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
    expect(count).toBe(0);
  });
});

// ── importCCF — entries ──────────────────────────────────────────────────────

describe('importCCF — entries', () => {
  test('imports all entries and reports correct count', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    writeSnapshot(snapshotDir);
    const result = await importCCF(snapshotDir);
    expect(result.ok).toBe(true);
    expect(result.stats.entriesImported).toBe(2);
    expect(result.stats.entriesSkipped).toBe(0);
  });

  test('entries are written to the DB with correct content', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const db = await openDb();
    const e1 = db.prepare('SELECT * FROM entries WHERE id = ?').get('ccf-e1');
    expect(e1).toBeDefined();
    expect(e1.content).toBe('First imported entry');
  });

  test('preserves created_at timestamp', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const db = await openDb();
    const e1 = db.prepare('SELECT * FROM entries WHERE id = ?').get('ccf-e1');
    expect(e1.created_at).toBe('2026-01-01T10:00:00Z');
  });

  test('skips entries whose ID already exists', async () => {
    const { importCCF }  = require('../../../src/backend/import/ccf-import');
    const { createEntry } = require('../../../src/backend/db/entries');
    const { openDb }     = require('../../../src/backend/db/connection');

    // Pre-seed an entry with the same ID
    const db = await openDb();
    db.prepare('INSERT INTO entries (id, content, created_at) VALUES (?, ?, ?)')
      .run('ccf-e1', 'existing content', '2025-01-01T00:00:00Z');

    writeSnapshot(snapshotDir);
    const result = await importCCF(snapshotDir);
    expect(result.stats.entriesSkipped).toBe(1);
    expect(result.stats.entriesImported).toBe(1);

    // Original content must be preserved
    const e1 = db.prepare('SELECT * FROM entries WHERE id = ?').get('ccf-e1');
    expect(e1.content).toBe('existing content');
  });
});

// ── importCCF — tags ─────────────────────────────────────────────────────────

describe('importCCF — tags', () => {
  test('imports tags for each entry', async () => {
    const { importCCF }       = require('../../../src/backend/import/ccf-import');
    const { getTagsForEntry } = require('../../../src/backend/db/tags');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const tags = await getTagsForEntry('ccf-e1');
    const tagNames = tags.map((t) => t.name);
    expect(tagNames).toEqual(expect.arrayContaining(['ideas', 'project:alpha']));
  });

  test('entry with no tags imports cleanly', async () => {
    const { importCCF }       = require('../../../src/backend/import/ccf-import');
    const { getTagsForEntry } = require('../../../src/backend/db/tags');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const tags = await getTagsForEntry('ccf-e2');
    expect(tags).toEqual([]);
  });
});

// ── importCCF — themes ───────────────────────────────────────────────────────

describe('importCCF — themes', () => {
  test('imports themes and reports correct count', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    writeSnapshot(snapshotDir);
    const result = await importCCF(snapshotDir);
    expect(result.stats.themesImported).toBe(1);
    expect(result.stats.themesSkipped).toBe(0);
  });

  test('theme is written to DB with correct name', async () => {
    const { importCCF }  = require('../../../src/backend/import/ccf-import');
    const { openDb }     = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const db = await openDb();
    const t = db.prepare('SELECT * FROM themes WHERE id = ?').get('ccf-t1');
    expect(t).toBeDefined();
    expect(t.name).toBe('Imported Theme');
    expect(t.description).toBe('A theme from the snapshot');
  });

  test('theme entry memberships are created', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const db = await openDb();
    const members = db.prepare('SELECT entry_id FROM theme_entries WHERE theme_id = ?')
      .all('ccf-t1');
    const ids = members.map((m) => m.entry_id);
    expect(ids).toEqual(expect.arrayContaining(['ccf-e1', 'ccf-e2']));
  });

  test('skips themes whose ID already exists', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    const db = await openDb();
    db.prepare('INSERT INTO themes (id, name, description) VALUES (?, ?, ?)')
      .run('ccf-t1', 'existing theme', '');
    writeSnapshot(snapshotDir);
    const result = await importCCF(snapshotDir);
    expect(result.stats.themesSkipped).toBe(1);
    const t = db.prepare('SELECT * FROM themes WHERE id = ?').get('ccf-t1');
    expect(t.name).toBe('existing theme');
  });
});

// ── importCCF — embeddings ───────────────────────────────────────────────────

describe('importCCF — embeddings', () => {
  test('imports embeddings when present', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir, { embeddings: defaultEmbeddings() });
    const result = await importCCF(snapshotDir);
    expect(result.stats.embeddingsImported).toBe(2);
    const db = await openDb();
    const emb = db.prepare('SELECT * FROM embeddings WHERE entry_id = ?').get('ccf-e1');
    expect(emb).toBeDefined();
    expect(emb.model_name).toBe('test-model');
  });

  test('ok:true and zero embeddings when embeddings folder absent', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    writeSnapshot(snapshotDir); // no embeddings
    const result = await importCCF(snapshotDir);
    expect(result.ok).toBe(true);
    expect(result.stats.embeddingsImported).toBe(0);
  });
});

// ── importCCF — empty corpus ─────────────────────────────────────────────────

describe('importCCF — empty corpus', () => {
  test('handles a snapshot with no entries or themes', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    writeSnapshot(snapshotDir, { entries: [], themes: [] });
    const result = await importCCF(snapshotDir);
    expect(result.ok).toBe(true);
    expect(result.stats.entriesImported).toBe(0);
    expect(result.stats.themesImported).toBe(0);
  });
});

// ── importCCF — atomicity ────────────────────────────────────────────────────

describe('importCCF — atomicity', () => {
  test('all entries are present after a successful import', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');
    writeSnapshot(snapshotDir);
    await importCCF(snapshotDir);
    const db = await openDb();
    const count = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
    expect(count).toBe(2);
  });
});
