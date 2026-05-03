'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// Point config at a temp dir before any module is loaded.
let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-conn-'));
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

async function getDb() {
  const { openDb } = require('../../../src/backend/db/connection');
  return openDb();
}

// ---------------------------------------------------------------------------

describe('openDb', () => {
  test('returns a db instance', async () => {
    const db = await getDb();
    expect(db).toBeDefined();
  });

  test('returns the same singleton on repeated calls', async () => {
    const { openDb } = require('../../../src/backend/db/connection');
    const a = await openDb();
    const b = await openDb();
    expect(a).toBe(b);
  });

  test('persists the database file to disk', async () => {
    await getDb();
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    db.exec('CREATE TABLE IF NOT EXISTS test_persist (id INTEGER PRIMARY KEY)');
    const dbPath = path.join(tmpDir, 'neurologue.db');
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});

describe('SqlJsDb — prepare/run/get/all', () => {
  test('run inserts a row', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE t (x TEXT)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run('hello');
    const row = db.prepare('SELECT x FROM t').get();
    expect(row.x).toBe('hello');
  });

  test('get returns undefined when no rows match', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE t2 (x TEXT)');
    const row = db.prepare('SELECT x FROM t2 WHERE x = ?').get('missing');
    expect(row).toBeUndefined();
  });

  test('all returns every row', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE t3 (n INTEGER)');
    db.prepare('INSERT INTO t3 (n) VALUES (?)').run(1);
    db.prepare('INSERT INTO t3 (n) VALUES (?)').run(2);
    db.prepare('INSERT INTO t3 (n) VALUES (?)').run(3);
    const rows = db.prepare('SELECT n FROM t3 ORDER BY n').all();
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  test('run with array param works', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE t4 (x TEXT)');
    db.prepare('INSERT INTO t4 (x) VALUES (?)').run(['world']);
    const row = db.prepare('SELECT x FROM t4').get();
    expect(row.x).toBe('world');
  });
});

describe('SqlJsDb — transaction', () => {
  test('commits on success', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE tx (v TEXT)');
    db.transaction(() => {
      db.prepare('INSERT INTO tx (v) VALUES (?)').run('a');
      db.prepare('INSERT INTO tx (v) VALUES (?)').run('b');
    })();
    const rows = db.prepare('SELECT v FROM tx ORDER BY v').all();
    expect(rows.map((r) => r.v)).toEqual(['a', 'b']);
  });

  test('rolls back on error', async () => {
    const db = await getDb();
    db.exec('CREATE TABLE tx2 (v TEXT)');
    expect(() => {
      db.transaction(() => {
        db.prepare('INSERT INTO tx2 (v) VALUES (?)').run('first');
        throw new Error('intentional failure');
      })();
    }).toThrow('intentional failure');
    const rows = db.prepare('SELECT v FROM tx2').all();
    expect(rows).toHaveLength(0);
  });
});

describe('closeDb', () => {
  test('closes and clears the singleton', async () => {
    const { openDb, closeDb } = require('../../../src/backend/db/connection');
    const a = await openDb();
    closeDb();
    const b = await openDb();
    // After close, openDb creates a fresh instance — not the same object
    expect(b).not.toBe(a);
  });
});
