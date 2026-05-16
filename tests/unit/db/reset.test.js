'use strict';

/**
 * Tests for src/backend/db/reset.js
 *
 * Verifies that resetDb() correctly wipes all data rows from every table
 * while leaving the schema intact.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const DEMO_DIR = path.join(__dirname, '../../../resources/demo');

// ── setup / teardown ──────────────────────────────────────────────────────────

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrlg-reset-'));
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

// ── helpers ───────────────────────────────────────────────────────────────────

async function countRows(db, table) {
  // Check table exists first
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  if (!exists) return null;
  const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get();
  return row ? row.n : 0;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('resetDb — empty corpus', () => {
  test('returns ok on an already-empty database', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const result = await resetDb();
    expect(result).toBeDefined();
    expect(result.rowsRemaining).toBe(0);
  });

  test('does not throw on an empty database', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    await expect(resetDb()).resolves.not.toThrow();
  });
});

describe('resetDb — after importing demo content', () => {
  beforeEach(async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
  });

  test('entries table is empty after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    expect(await countRows(db, 'entries')).toBe(0);
  });

  test('themes table is empty after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    expect(await countRows(db, 'themes')).toBe(0);
  });

  test('theme_entries table is empty after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    expect(await countRows(db, 'theme_entries')).toBe(0);
  });

  test('entry_tags table is empty after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    expect(await countRows(db, 'entry_tags')).toBe(0);
  });

  test('tags table is empty after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    expect(await countRows(db, 'tags')).toBe(0);
  });

  test('rowsRemaining is 0 after default reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const result = await resetDb();
    expect(result.rowsRemaining).toBe(0);
  });

  test('schema tables still exist after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb } = require('../../../src/backend/db/connection');
    await resetDb();
    const db = await openDb();
    // All core tables should still be present
    for (const table of ['entries', 'themes', 'theme_entries', 'entry_tags', 'tags', 'embeddings']) {
      const exists = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      expect(exists).toBeTruthy();
    }
  });

  test('import works again after reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await resetDb();
    const result = await importCCF(DEMO_DIR);
    expect(result.ok).toBe(true);
    expect(result.stats.entriesImported).toBe(21);
    expect(result.stats.themesImported).toBe(4);
  });

  test('created_at timestamps are preserved through export-reset-import cycle', async () => {
    const { resetDb }   = require('../../../src/backend/db/reset');
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const { openDb }    = require('../../../src/backend/db/connection');

    // Collect timestamps before reset
    const db = await openDb();
    const before = db
      .prepare('SELECT id, created_at FROM entries ORDER BY id')
      .all()
      .map((r) => `${r.id}:${r.created_at}`);

    await resetDb();
    await importCCF(DEMO_DIR);

    const after = db
      .prepare('SELECT id, created_at FROM entries ORDER BY id')
      .all()
      .map((r) => `${r.id}:${r.created_at}`);

    expect(after).toEqual(before);
  });
});

describe('resetDb — keepTags option', () => {
  beforeEach(async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
  });

  test('keepTags:false (default) clears the tags table', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb }  = require('../../../src/backend/db/connection');
    await resetDb({ keepTags: false });
    const db = await openDb();
    expect(await countRows(db, 'tags')).toBe(0);
  });

  test('keepTags:true preserves tag names', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb }  = require('../../../src/backend/db/connection');
    const db = await openDb();
    const tagsBefore = await countRows(db, 'tags');
    expect(tagsBefore).toBeGreaterThan(0);

    await resetDb({ keepTags: true });
    const tagsAfter = await countRows(db, 'tags');
    expect(tagsAfter).toBe(tagsBefore);
  });

  test('keepTags:true still clears entry_tags', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb }  = require('../../../src/backend/db/connection');
    await resetDb({ keepTags: true });
    const db = await openDb();
    expect(await countRows(db, 'entry_tags')).toBe(0);
  });

  test('keepTags:true still clears all entries', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb }  = require('../../../src/backend/db/connection');
    await resetDb({ keepTags: true });
    const db = await openDb();
    expect(await countRows(db, 'entries')).toBe(0);
  });

  test('keepTags:true still clears themes', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { openDb }  = require('../../../src/backend/db/connection');
    await resetDb({ keepTags: true });
    const db = await openDb();
    expect(await countRows(db, 'themes')).toBe(0);
  });

  test('tags are re-linkable to new entries after keepTags reset', async () => {
    const { resetDb } = require('../../../src/backend/db/reset');
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await resetDb({ keepTags: true });
    // Re-importing should work; tags that already exist will be reused
    const result = await importCCF(DEMO_DIR);
    expect(result.ok).toBe(true);
    expect(result.stats.entriesImported).toBe(21);
  });
});

describe('resetDb — CLEAR_ORDER export', () => {  test('CLEAR_ORDER contains all known data tables', () => {
    const { CLEAR_ORDER } = require('../../../src/backend/db/reset');
    const required = ['entries', 'themes', 'theme_entries', 'entry_tags', 'tags', 'embeddings', 'entry_revisions'];
    for (const t of required) {
      expect(CLEAR_ORDER).toContain(t);
    }
  });

  test('entries appears after its dependents in CLEAR_ORDER', () => {
    const { CLEAR_ORDER } = require('../../../src/backend/db/reset');
    const entryIdx = CLEAR_ORDER.indexOf('entries');
    for (const dep of ['entry_tags', 'embeddings', 'entry_revisions', 'theme_entries', 'entry_signals', 'contradictions']) {
      if (CLEAR_ORDER.includes(dep)) {
        expect(CLEAR_ORDER.indexOf(dep)).toBeLessThan(entryIdx);
      }
    }
  });
});
