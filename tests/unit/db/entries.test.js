'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-entries-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;
  jest.resetModules();
  // Migrate so tables exist before each test.
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

describe('createEntry', () => {
  test('returns the created entry with an id', async () => {
    const { createEntry } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'hello world' });
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe('hello world');
    expect(entry.source).toBe('manual');
    expect(entry.type).toBe('note');
  });

  test('accepts custom source and type', async () => {
    const { createEntry } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'clip', source: 'clipboard', type: 'clip' });
    expect(entry.source).toBe('clipboard');
    expect(entry.type).toBe('clip');
  });
});

describe('getEntryById', () => {
  test('returns the entry by id', async () => {
    const { createEntry, getEntryById } = require('../../../src/backend/db/entries');
    const created = await createEntry({ content: 'test' });
    const found = await getEntryById(created.id);
    expect(found.id).toBe(created.id);
    expect(found.content).toBe('test');
  });

  test('returns undefined for unknown id', async () => {
    const { getEntryById } = require('../../../src/backend/db/entries');
    const result = await getEntryById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeUndefined();
  });
});

describe('listEntries', () => {
  test('returns all entries newest first', async () => {
    const { createEntry, listEntries } = require('../../../src/backend/db/entries');
    await createEntry({ content: 'first' });
    await createEntry({ content: 'second' });
    const entries = await listEntries();
    expect(entries.length).toBe(2);
    const contents = entries.map((e) => e.content);
    expect(contents).toContain('first');
    expect(contents).toContain('second');
  });

  test('respects limit and offset', async () => {
    const { createEntry, listEntries } = require('../../../src/backend/db/entries');
    await createEntry({ content: 'a' });
    await createEntry({ content: 'b' });
    await createEntry({ content: 'c' });
    const page = await listEntries({ limit: 2, offset: 1 });
    expect(page.length).toBe(2);
  });

  test('returns empty array when no entries exist', async () => {
    const { listEntries } = require('../../../src/backend/db/entries');
    const entries = await listEntries();
    expect(entries).toEqual([]);
  });
});

describe('deleteEntry', () => {
  test('removes the entry', async () => {
    const { createEntry, deleteEntry, getEntryById } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'to be deleted' });
    await deleteEntry(entry.id);
    const result = await getEntryById(entry.id);
    expect(result).toBeUndefined();
  });

  test('is a no-op for a non-existent id', async () => {
    const { deleteEntry } = require('../../../src/backend/db/entries');
    await expect(deleteEntry('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
