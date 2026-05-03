'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-tags-'));
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

describe('upsertTag', () => {
  test('creates a new tag', async () => {
    const { upsertTag } = require('../../../src/backend/db/tags');
    const tag = await upsertTag('Neuroscience');
    expect(tag.id).toBeDefined();
    expect(tag.name).toBe('neuroscience'); // normalised to lowercase
  });

  test('is idempotent — returns same tag on duplicate', async () => {
    const { upsertTag } = require('../../../src/backend/db/tags');
    const a = await upsertTag('ideas');
    const b = await upsertTag('IDEAS');
    expect(a.id).toBe(b.id);
  });

  test('trims whitespace', async () => {
    const { upsertTag } = require('../../../src/backend/db/tags');
    const tag = await upsertTag('  focus  ');
    expect(tag.name).toBe('focus');
  });
});

describe('listTags', () => {
  test('returns all tags sorted alphabetically', async () => {
    const { upsertTag, listTags } = require('../../../src/backend/db/tags');
    await upsertTag('zen');
    await upsertTag('alpha');
    await upsertTag('middle');
    const tags = await listTags();
    expect(tags.map((t) => t.name)).toEqual(['alpha', 'middle', 'zen']);
  });

  test('returns empty array when no tags exist', async () => {
    const { listTags } = require('../../../src/backend/db/tags');
    expect(await listTags()).toEqual([]);
  });
});

describe('setTagsForEntry / getTagsForEntry', () => {
  async function makeEntry(content = 'test') {
    const { createEntry } = require('../../../src/backend/db/entries');
    return createEntry({ content });
  }

  test('associates tags with an entry', async () => {
    const { setTagsForEntry, getTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await makeEntry('tagged entry');
    await setTagsForEntry(entry.id, ['alpha', 'beta']);
    const tags = await getTagsForEntry(entry.id);
    expect(tags.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
  });

  test('creates tags that do not yet exist', async () => {
    const { setTagsForEntry, listTags } = require('../../../src/backend/db/tags');
    const entry = await makeEntry();
    await setTagsForEntry(entry.id, ['brand-new']);
    const all = await listTags();
    expect(all.some((t) => t.name === 'brand-new')).toBe(true);
  });

  test('replaces existing associations on second call', async () => {
    const { setTagsForEntry, getTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await makeEntry();
    await setTagsForEntry(entry.id, ['old']);
    await setTagsForEntry(entry.id, ['new']);
    const tags = await getTagsForEntry(entry.id);
    expect(tags.map((t) => t.name)).toEqual(['new']);
  });

  test('handles empty tag list (removes all associations)', async () => {
    const { setTagsForEntry, getTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await makeEntry();
    await setTagsForEntry(entry.id, ['removeme']);
    await setTagsForEntry(entry.id, []);
    const tags = await getTagsForEntry(entry.id);
    expect(tags).toHaveLength(0);
  });

  test('returns empty array when entry has no tags', async () => {
    const { getTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await makeEntry();
    const tags = await getTagsForEntry(entry.id);
    expect(tags).toEqual([]);
  });
});
