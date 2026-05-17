'use strict';

/**
 * Tests for the bundled demo CCF corpus at resources/demo/.
 *
 * Two concerns:
 *  1. Static validity — the demo bundle passes CCF schema validation.
 *  2. Import fidelity — importCCF() successfully loads all entries and themes
 *     into a fresh in-memory database.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const DEMO_DIR = path.join(__dirname, '../../../resources/demo');

// ── setup / teardown ──────────────────────────────────────────────────────────

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrlg-demo-'));
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

// ── static bundle checks ──────────────────────────────────────────────────────

describe('demo bundle — static validity', () => {
  test('required files exist', () => {
    expect(fs.existsSync(path.join(DEMO_DIR, 'entries.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(DEMO_DIR, 'themes.json'))).toBe(true);
    expect(fs.existsSync(path.join(DEMO_DIR, 'metadata.json'))).toBe(true);
  });

  test('passes CCF validation', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const result = validateCCF(DEMO_DIR);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('entries.jsonl parses to expected count', () => {
    const lines = fs.readFileSync(path.join(DEMO_DIR, 'entries.jsonl'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines.length).toBe(23);
  });

  test('all entry IDs are unique', () => {
    const lines = fs.readFileSync(path.join(DEMO_DIR, 'entries.jsonl'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => JSON.parse(l));
    const ids = lines.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('themes.json parses to expected count', () => {
    const themes = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'themes.json'), 'utf8'));
    expect(Array.isArray(themes)).toBe(true);
    expect(themes.length).toBe(4);
  });

  test('all theme IDs are unique', () => {
    const themes = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'themes.json'), 'utf8'));
    const ids = themes.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('all theme entry_ids reference existing entries', () => {
    const entries = fs.readFileSync(path.join(DEMO_DIR, 'entries.jsonl'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => JSON.parse(l));
    const themes = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'themes.json'), 'utf8'));
    const entryIds = new Set(entries.map((e) => e.id));
    for (const theme of themes) {
      for (const eid of (theme.entry_ids || [])) {
        expect(entryIds.has(eid)).toBe(true);
      }
    }
  });

  test('metadata.json has required fields', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'metadata.json'), 'utf8'));
    expect(meta.format_version).toBeDefined();
    expect(meta.exported_at).toBeDefined();
    expect(typeof meta.app).toBe('object');
    expect(typeof meta.notes).toBe('object');
  });

  test('every entry has id, text, and created_at', () => {
    const lines = fs.readFileSync(path.join(DEMO_DIR, 'entries.jsonl'), 'utf8')
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => JSON.parse(l));
    for (const entry of lines) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.text).toBe('string');
      expect(entry.text.length).toBeGreaterThan(0);
      expect(typeof entry.created_at).toBe('string');
    }
  });

  test('every theme has id, name, summary, and entry_ids', () => {
    const themes = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'themes.json'), 'utf8'));
    for (const theme of themes) {
      expect(typeof theme.id).toBe('string');
      expect(typeof theme.name).toBe('string');
      expect(typeof theme.summary).toBe('string');
      expect(Array.isArray(theme.entry_ids)).toBe(true);
      expect(theme.entry_ids.length).toBeGreaterThan(0);
    }
  });
});

// ── import round-trip ─────────────────────────────────────────────────────────

describe('demo bundle — import fidelity', () => {
  test('importCCF returns ok:true for the demo bundle', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const result = await importCCF(DEMO_DIR);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('imports all 23 entries', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const result = await importCCF(DEMO_DIR);
    expect(result.stats.entriesImported).toBe(23);
    expect(result.stats.entriesSkipped).toBe(0);
  });

  test('imports all 4 themes', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    const result = await importCCF(DEMO_DIR);
    expect(result.stats.themesImported).toBe(4);
    expect(result.stats.themesSkipped).toBe(0);
  });

  test('entries appear in the database after import', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { n } = db.prepare('SELECT COUNT(*) as n FROM entries').get();
    expect(n).toBe(23);
  });

  test('themes appear in the database after import', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { n } = db.prepare('SELECT COUNT(*) as n FROM themes').get();
    expect(n).toBe(4);
  });

  test('theme memberships are created after import', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { n } = db.prepare('SELECT COUNT(*) as n FROM theme_entries').get();
    expect(n).toBe(21); // 7+5+5+4 themed entries (demo_t001 has 7: e001-e005 + e022-e023)
  });

  test('tags are applied to entries after import', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { n } = db.prepare('SELECT COUNT(*) as n FROM entry_tags').get();
    expect(n).toBeGreaterThan(0);
  });

  test('second import skips all entries (onConflict: skip)', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    const second = await importCCF(DEMO_DIR);
    expect(second.stats.entriesImported).toBe(0);
    expect(second.stats.entriesSkipped).toBe(23);
    expect(second.stats.themesSkipped).toBe(4);
    expect(second.ok).toBe(true);
  });

  test('second import does not duplicate entries in the database', async () => {
    const { importCCF } = require('../../../src/backend/import/ccf-import');
    await importCCF(DEMO_DIR);
    await importCCF(DEMO_DIR);
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { n } = db.prepare('SELECT COUNT(*) as n FROM entries').get();
    expect(n).toBe(23);
  });
});
