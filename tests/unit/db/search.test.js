'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-search-'));
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

async function makeEntry(content, tags = []) {
  const { createEntry } = require('../../../src/backend/db/entries');
  const { setTagsForEntry } = require('../../../src/backend/db/tags');
  const entry = await createEntry({ content });
  if (tags.length > 0) await setTagsForEntry(entry.id, tags);
  return entry;
}

// ── searchEntriesText ──────────────────────────────────────────────────────

describe('searchEntriesText', () => {
  test('returns entries whose content matches the query', async () => {
    const { searchEntriesText } = require('../../../src/backend/db/search');
    await makeEntry('the quick brown fox');
    await makeEntry('a lazy dog');
    const results = await searchEntriesText('fox');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('the quick brown fox');
  });

  test('is case-insensitive', async () => {
    const { searchEntriesText } = require('../../../src/backend/db/search');
    await makeEntry('Neuroscience is fascinating');
    const results = await searchEntriesText('NEUROSCIENCE');
    expect(results).toHaveLength(1);
  });

  test('returns multiple matching entries', async () => {
    const { searchEntriesText } = require('../../../src/backend/db/search');
    await makeEntry('idea about memory');
    await makeEntry('another idea about focus');
    await makeEntry('no match here');
    const results = await searchEntriesText('idea');
    expect(results).toHaveLength(2);
  });

  test('returns empty array when nothing matches', async () => {
    const { searchEntriesText } = require('../../../src/backend/db/search');
    await makeEntry('completely unrelated content');
    const results = await searchEntriesText('xyzzy');
    expect(results).toHaveLength(0);
  });

  test('respects limit and offset', async () => {
    const { searchEntriesText } = require('../../../src/backend/db/search');
    await makeEntry('match one');
    await makeEntry('match two');
    await makeEntry('match three');
    const page = await searchEntriesText('match', { limit: 2, offset: 0 });
    expect(page).toHaveLength(2);
    const next = await searchEntriesText('match', { limit: 2, offset: 2 });
    expect(next).toHaveLength(1);
  });
});

// ── listEntriesByTag ───────────────────────────────────────────────────────

describe('listEntriesByTag', () => {
  test('returns entries associated with the given tag', async () => {
    const { listEntriesByTag } = require('../../../src/backend/db/search');
    await makeEntry('tagged entry', ['alpha']);
    await makeEntry('untagged entry');
    const results = await listEntriesByTag('alpha');
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('tagged entry');
  });

  test('is case-insensitive (tag name is normalised)', async () => {
    const { listEntriesByTag } = require('../../../src/backend/db/search');
    await makeEntry('tagged', ['ALPHA']);
    const results = await listEntriesByTag('alpha');
    expect(results).toHaveLength(1);
  });

  test('returns empty array for unknown tag', async () => {
    const { listEntriesByTag } = require('../../../src/backend/db/search');
    await makeEntry('entry with no matching tag', ['beta']);
    const results = await listEntriesByTag('nonexistent');
    expect(results).toHaveLength(0);
  });

  test('returns multiple entries for the same tag', async () => {
    const { listEntriesByTag } = require('../../../src/backend/db/search');
    await makeEntry('first', ['shared']);
    await makeEntry('second', ['shared']);
    await makeEntry('third', ['other']);
    const results = await listEntriesByTag('shared');
    expect(results).toHaveLength(2);
  });
});

// ── getEntryWithTags ───────────────────────────────────────────────────────

describe('getEntryWithTags', () => {
  test('returns entry with tags array', async () => {
    const { getEntryWithTags } = require('../../../src/backend/db/search');
    const entry = await makeEntry('full entry', ['foo', 'bar']);
    const result = await getEntryWithTags(entry.id);
    expect(result).toBeDefined();
    expect(result.content).toBe('full entry');
    expect(result.tags).toHaveLength(2);
    expect(result.tags.map((t) => t.name).sort()).toEqual(['bar', 'foo']);
  });

  test('returns entry with empty tags array when no tags', async () => {
    const { getEntryWithTags } = require('../../../src/backend/db/search');
    const entry = await makeEntry('no tags');
    const result = await getEntryWithTags(entry.id);
    expect(result.tags).toEqual([]);
  });

  test('returns undefined for unknown id', async () => {
    const { getEntryWithTags } = require('../../../src/backend/db/search');
    const result = await getEntryWithTags('00000000-0000-0000-0000-000000000000');
    expect(result).toBeUndefined();
  });
});

// ── listEntriesFiltered ───────────────────────────────────────────────────

describe('listEntriesFiltered', () => {
  async function makeEntryWithCategory(content, category, tags = []) {
    const { createEntry, updateEntryCategory } = require('../../../src/backend/db/entries');
    const { setTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await createEntry({ content });
    await updateEntryCategory(entry.id, category, 'llm');
    if (tags.length) await setTagsForEntry(entry.id, tags);
    return entry;
  }

  test('returns all entries when no filters are set', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntry('alpha');
    await makeEntry('beta');
    const results = await listEntriesFiltered();
    expect(results.length).toBe(2);
  });

  test('filters by tag only', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntry('tagged', ['node']);
    await makeEntry('untagged');
    const results = await listEntriesFiltered({ tag: 'node' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('tagged');
  });

  test('filters by category only', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntryWithCategory('task entry', 'Task');
    await makeEntryWithCategory('idea entry', 'Idea');
    const results = await listEntriesFiltered({ category: 'Task' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('task entry');
  });

  test('filters by tag AND category (AND semantics)', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntryWithCategory('match', 'Task', ['work']);
    await makeEntryWithCategory('wrong cat', 'Idea', ['work']);
    await makeEntryWithCategory('wrong tag', 'Task', ['home']);
    const results = await listEntriesFiltered({ tag: 'work', category: 'Task' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('match');
  });

  test('filters by text query only', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntry('needle in haystack');
    await makeEntry('nothing here');
    const results = await listEntriesFiltered({ query: 'needle' });
    expect(results.length).toBe(1);
  });

  test('combines text query with category filter', async () => {
    const { listEntriesFiltered } = require('../../../src/backend/db/search');
    await makeEntryWithCategory('buy groceries', 'Task');
    await makeEntryWithCategory('buy a thought', 'Thought');
    await makeEntryWithCategory('sell stocks', 'Task');
    const results = await listEntriesFiltered({ query: 'buy', category: 'Task' });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('buy groceries');
  });
});

// ── listCategoriesWithCounts ───────────────────────────────────────────────

describe('listCategoriesWithCounts', () => {
  test('returns categories with counts', async () => {
    const { createEntry, updateEntryCategory } = require('../../../src/backend/db/entries');
    const { listCategoriesWithCounts } = require('../../../src/backend/db/search');
    const e1 = await createEntry({ content: 'a' });
    const e2 = await createEntry({ content: 'b' });
    const e3 = await createEntry({ content: 'c' });
    await updateEntryCategory(e1.id, 'Task', 'llm');
    await updateEntryCategory(e2.id, 'Task', 'llm');
    await updateEntryCategory(e3.id, 'Idea', 'llm');
    const cats = await listCategoriesWithCounts();
    const taskRow = cats.find((r) => r.category === 'Task');
    const ideaRow = cats.find((r) => r.category === 'Idea');
    expect(taskRow.count).toBe(2);
    expect(ideaRow.count).toBe(1);
  });

  test('returns empty array when no categories assigned', async () => {
    const { listCategoriesWithCounts } = require('../../../src/backend/db/search');
    const cats = await listCategoriesWithCounts();
    expect(cats).toHaveLength(0);
  });
});
