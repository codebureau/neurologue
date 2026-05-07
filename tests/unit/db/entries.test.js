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

describe('updateEntry', () => {
  test('updates the content of an existing entry', async () => {
    const { createEntry, updateEntry } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'original text' });
    const updated = await updateEntry(entry.id, 'updated text');
    expect(updated.content).toBe('updated text');
    expect(updated.edited_at).not.toBeNull();
  });

  test('preserves original_content on first edit', async () => {
    const { createEntry, updateEntry, getEntryById } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'first version' });
    await updateEntry(entry.id, 'second version');
    const saved = await getEntryById(entry.id);
    expect(saved.original_content).toBe('first version');
    expect(saved.content).toBe('second version');
  });

  test('does not overwrite original_content on subsequent edits', async () => {
    const { createEntry, updateEntry, getEntryById } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'v1' });
    await updateEntry(entry.id, 'v2');
    await updateEntry(entry.id, 'v3');
    const saved = await getEntryById(entry.id);
    expect(saved.original_content).toBe('v1');
    expect(saved.content).toBe('v3');
  });

  test('returns undefined for an unknown id', async () => {
    const { updateEntry } = require('../../../src/backend/db/entries');
    const result = await updateEntry('00000000-0000-0000-0000-000000000000', 'anything');
    expect(result).toBeUndefined();
  });
});

describe('getEntryRevisions', () => {
  test('returns an empty array when no edits have been made', async () => {
    const { createEntry, getEntryRevisions } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'no edits' });
    const revisions = await getEntryRevisions(entry.id);
    expect(revisions).toEqual([]);
  });

  test('returns one revision after the first edit', async () => {
    const { createEntry, updateEntry, getEntryRevisions } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'original' });
    await updateEntry(entry.id, 'edited');
    const revisions = await getEntryRevisions(entry.id);
    expect(revisions.length).toBe(1);
    expect(revisions[0].content).toBe('original');
    expect(revisions[0].entry_id).toBe(entry.id);
  });

  test('accumulates a revision per edit, newest first', async () => {
    const { createEntry, updateEntry, getEntryRevisions } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'v1' });
    await updateEntry(entry.id, 'v2');
    await updateEntry(entry.id, 'v3');
    const revisions = await getEntryRevisions(entry.id);
    expect(revisions.length).toBe(2);
    // newest first: v2 was outgoing content on second update
    expect(revisions[0].content).toBe('v2');
    expect(revisions[1].content).toBe('v1');
  });

  test('revisions are deleted when entry is deleted (cascade)', async () => {
    const { createEntry, updateEntry, deleteEntry, getEntryRevisions } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'to delete' });
    await updateEntry(entry.id, 'edit');
    await deleteEntry(entry.id);
    const revisions = await getEntryRevisions(entry.id);
    expect(revisions).toEqual([]);
  });
});

describe('updateEntryCategory', () => {
  test('sets the LLM-assigned category', async () => {
    const { createEntry, updateEntryCategory } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'buy milk' });
    expect(entry.category).toBeNull();

    const updated = await updateEntryCategory(entry.id, 'Task', 'llm');
    expect(updated.category).toBe('Task');
    expect(updated.user_category).toBeNull();
  });

  test('sets a user category override', async () => {
    const { createEntry, updateEntryCategory } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'interesting thought' });
    await updateEntryCategory(entry.id, 'Thought', 'llm');
    const updated = await updateEntryCategory(entry.id, 'Idea', 'user');
    expect(updated.category).toBe('Thought');
    expect(updated.user_category).toBe('Idea');
  });

  test('can clear a user override by passing null', async () => {
    const { createEntry, updateEntryCategory } = require('../../../src/backend/db/entries');
    const entry = await createEntry({ content: 'something' });
    await updateEntryCategory(entry.id, 'Task', 'user');
    const cleared = await updateEntryCategory(entry.id, null, 'user');
    expect(cleared.user_category).toBeNull();
  });

  test('returns undefined for unknown id', async () => {
    const { updateEntryCategory } = require('../../../src/backend/db/entries');
    const result = await updateEntryCategory('no-such-id', 'Task', 'llm');
    // getEntryById returns undefined for missing rows
    expect(result).toBeUndefined();
  });
});

describe('listEntriesWithoutCategory', () => {
  test('returns ids of entries with no category', async () => {
    const { createEntry, updateEntryCategory, listEntriesWithoutCategory } = require('../../../src/backend/db/entries');
    const a = await createEntry({ content: 'alpha' });
    const b = await createEntry({ content: 'beta' });
    await updateEntryCategory(a.id, 'Task', 'llm');

    const ids = await listEntriesWithoutCategory();
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
  });

  test('returns empty array when all entries are classified', async () => {
    const { createEntry, updateEntryCategory, listEntriesWithoutCategory } = require('../../../src/backend/db/entries');
    const e = await createEntry({ content: 'done' });
    await updateEntryCategory(e.id, 'Thought', 'llm');
    const ids = await listEntriesWithoutCategory();
    expect(ids).toHaveLength(0);
  });
});

describe('getActivityByDay', () => {
  test('returns counts grouped by day', async () => {
    const { createEntry, getActivityByDay } = require('../../../src/backend/db/entries');
    await createEntry({ content: 'a' });
    await createEntry({ content: 'b' });
    const rows = await getActivityByDay(364);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = rows.find((r) => r.day === today);
    expect(todayRow).toBeDefined();
    expect(todayRow.count).toBe(2);
  });

  test('returns empty array when no entries exist', async () => {
    const { getActivityByDay } = require('../../../src/backend/db/entries');
    const rows = await getActivityByDay(364);
    expect(rows).toEqual([]);
  });

  test('excludes entries older than the requested window', async () => {
    const { getActivityByDay } = require('../../../src/backend/db/entries');
    // Insert an entry with a very old timestamp directly via connection
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    const { randomUUID } = require('crypto');
    db.prepare(
      `INSERT INTO entries (id, content, source, type, metadata, created_at)
       VALUES (?, ?, 'manual', 'note', '{}', ?)`
    ).run(randomUUID(), 'ancient', '1990-01-01T00:00:00.000Z');

    const rows = await getActivityByDay(364);
    const oldRow = rows.find((r) => r.day === '1990-01-01');
    expect(oldRow).toBeUndefined();
  });
});
