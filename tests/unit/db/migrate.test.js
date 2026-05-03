'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-mig-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;
  jest.resetModules();
});

afterEach(() => {
  try {
    const { closeDb } = require('../../../src/backend/db/connection');
    closeDb();
  } catch { /* not loaded */ }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.NEUROLOGUE_DATA_PATH;
});

const EXPECTED_TABLES = [
  'entries',
  'tags',
  'entry_tags',
  'embeddings',
  'themes',
  'theme_entries',
  'schema_migrations',
];

describe('runMigrations', () => {
  test('creates all expected tables', async () => {
    const { runMigrations } = require('../../../src/db/migrate');
    const { openDb } = require('../../../src/backend/db/connection');
    await runMigrations();
    const db = await openDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  test('records applied migrations in schema_migrations', async () => {
    const { runMigrations } = require('../../../src/db/migrate');
    const { openDb } = require('../../../src/backend/db/connection');
    await runMigrations();
    const db = await openDb();
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].version).toMatch(/\.sql$/);
  });

  test('is idempotent — running twice does not throw or duplicate records', async () => {
    const { runMigrations } = require('../../../src/db/migrate');
    const { openDb } = require('../../../src/backend/db/connection');
    await runMigrations();
    await runMigrations(); // second run — should be a no-op
    const db = await openDb();
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    // Counts should match exactly — no duplicates
    const versions = rows.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });
});
