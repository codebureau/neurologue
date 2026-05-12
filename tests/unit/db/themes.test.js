'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-themes-'));
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

describe('deleteTheme', () => {
  test('removes the theme from the database', async () => {
    const { openDb } = require('../../../src/backend/db/connection');
    const { listThemes, deleteTheme } = require('../../../src/backend/db/themes');
    const db = await openDb();

    // Insert a theme directly
    const id = 'test-theme-id';
    db.prepare("INSERT INTO themes (id, name) VALUES (?, ?)").run(id, 'Test Theme');

    await deleteTheme(id);

    const themes = await listThemes();
    expect(themes.find((t) => t.id === id)).toBeUndefined();
  });

  test('silently succeeds for a non-existent theme id', async () => {
    const { deleteTheme } = require('../../../src/backend/db/themes');
    await expect(deleteTheme('does-not-exist')).resolves.toBeUndefined();
  });

  test('removes associated theme_entries rows', async () => {
    const { openDb } = require('../../../src/backend/db/connection');
    const { createEntry } = require('../../../src/backend/db/entries');
    const { deleteTheme } = require('../../../src/backend/db/themes');

    const db = await openDb();
    const themeId = 'theme-with-entries';
    db.prepare("INSERT INTO themes (id, name) VALUES (?, ?)").run(themeId, 'Linked Theme');
    const entry = await createEntry({ content: 'some entry' });
    db.prepare("INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)").run(themeId, entry.id, 0.9);

    await deleteTheme(themeId);

    const remaining = db.prepare("SELECT * FROM theme_entries WHERE theme_id = ?").all(themeId);
    expect(remaining).toHaveLength(0);
  });
});
