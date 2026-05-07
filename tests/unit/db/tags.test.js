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

describe('listTagsWithCounts', () => {
  async function makeEntry(content = 'test') {
    const { createEntry } = require('../../../src/backend/db/entries');
    return createEntry({ content });
  }

  test('returns count of entries per tag', async () => {
    const { setTagsForEntry, listTagsWithCounts } = require('../../../src/backend/db/tags');
    const e1 = await makeEntry('one');
    const e2 = await makeEntry('two');
    await setTagsForEntry(e1.id, ['alpha', 'beta']);
    await setTagsForEntry(e2.id, ['alpha']);
    const tags = await listTagsWithCounts();
    const alpha = tags.find((t) => t.name === 'alpha');
    const beta  = tags.find((t) => t.name === 'beta');
    expect(alpha.count).toBe(2);
    expect(beta.count).toBe(1);
  });

  test('sorts by count desc then name asc', async () => {
    const { setTagsForEntry, listTagsWithCounts } = require('../../../src/backend/db/tags');
    const e1 = await makeEntry('a');
    const e2 = await makeEntry('b');
    const e3 = await makeEntry('c');
    await setTagsForEntry(e1.id, ['rare', 'common']);
    await setTagsForEntry(e2.id, ['common']);
    await setTagsForEntry(e3.id, ['common']);
    const tags = await listTagsWithCounts();
    expect(tags[0].name).toBe('common');
    expect(tags[1].name).toBe('rare');
  });

  test('includes tags with zero usage', async () => {
    const { upsertTag, listTagsWithCounts } = require('../../../src/backend/db/tags');
    await upsertTag('orphan');
    const tags = await listTagsWithCounts();
    const orphan = tags.find((t) => t.name === 'orphan');
    expect(orphan).toBeDefined();
    expect(orphan.count).toBe(0);
  });
});

describe('renameTag', () => {
  test('renames a tag successfully', async () => {
    const { upsertTag, renameTag, listTags } = require('../../../src/backend/db/tags');
    const tag = await upsertTag('oldname');
    const res = await renameTag(tag.id, 'newname');
    expect(res.ok).toBe(true);
    const all = await listTags();
    expect(all.map((t) => t.name)).toContain('newname');
    expect(all.map((t) => t.name)).not.toContain('oldname');
  });

  test('normalises the new name to lowercase', async () => {
    const { upsertTag, renameTag, listTags } = require('../../../src/backend/db/tags');
    const tag = await upsertTag('original');
    await renameTag(tag.id, 'UPPER');
    const all = await listTags();
    expect(all.map((t) => t.name)).toContain('upper');
  });

  test('returns error on collision with existing tag', async () => {
    const { upsertTag, renameTag } = require('../../../src/backend/db/tags');
    const a = await upsertTag('apple');
    await upsertTag('banana');
    const res = await renameTag(a.id, 'banana');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });

  test('returns error for empty name', async () => {
    const { upsertTag, renameTag } = require('../../../src/backend/db/tags');
    const tag = await upsertTag('foo');
    const res = await renameTag(tag.id, '  ');
    expect(res.ok).toBe(false);
  });
});

describe('deleteTag', () => {
  async function makeEntry(content = 'test') {
    const { createEntry } = require('../../../src/backend/db/entries');
    return createEntry({ content });
  }

  test('removes the tag and its associations', async () => {
    const { upsertTag, deleteTag, listTags, setTagsForEntry, getTagsForEntry } = require('../../../src/backend/db/tags');
    const entry = await makeEntry('del-test');
    await setTagsForEntry(entry.id, ['todelete']);
    const tag = (await listTags()).find((t) => t.name === 'todelete');
    await deleteTag(tag.id);
    const remaining = await listTags();
    expect(remaining.map((t) => t.name)).not.toContain('todelete');
    const entryTags = await getTagsForEntry(entry.id);
    expect(entryTags).toHaveLength(0);
  });
});

describe('mergeTag', () => {
  async function makeEntry(content = 'test') {
    const { createEntry } = require('../../../src/backend/db/entries');
    return createEntry({ content });
  }

  test('re-tags all entries and removes the source tag', async () => {
    const { setTagsForEntry, getTagsForEntry, listTags, mergeTag } = require('../../../src/backend/db/tags');
    const e1 = await makeEntry('entry-one');
    const e2 = await makeEntry('entry-two');
    await setTagsForEntry(e1.id, ['src']);
    await setTagsForEntry(e2.id, ['dst']);
    const all = await listTags();
    const srcTag = all.find((t) => t.name === 'src');
    const dstTag = all.find((t) => t.name === 'dst');

    const res = await mergeTag(srcTag.id, dstTag.id);
    expect(res.ok).toBe(true);
    expect(res.affected).toBe(1);

    // e1 should now have dst, src tag deleted
    const e1Tags = await getTagsForEntry(e1.id);
    expect(e1Tags.map((t) => t.name)).toContain('dst');
    const remaining = await listTags();
    expect(remaining.map((t) => t.name)).not.toContain('src');
  });

  test('does not duplicate tag if keep already present', async () => {
    const { setTagsForEntry, getTagsForEntry, listTags, mergeTag } = require('../../../src/backend/db/tags');
    const entry = await makeEntry('overlap');
    await setTagsForEntry(entry.id, ['src', 'dst']);
    const all = await listTags();
    const srcTag = all.find((t) => t.name === 'src');
    const dstTag = all.find((t) => t.name === 'dst');
    await mergeTag(srcTag.id, dstTag.id);
    const tags = await getTagsForEntry(entry.id);
    expect(tags.filter((t) => t.name === 'dst')).toHaveLength(1);
  });
});

describe('findSimilarTags', () => {
  test('finds format variants (hyphen vs concatenated)', async () => {
    const { upsertTag, findSimilarTags } = require('../../../src/backend/db/tags');
    await upsertTag('deep-learning');
    await upsertTag('deeplearning');
    const pairs = await findSimilarTags();
    const found = pairs.some((p) =>
      [p.a.name, p.b.name].includes('deep-learning') &&
      [p.a.name, p.b.name].includes('deeplearning')
    );
    expect(found).toBe(true);
  });

  test('finds spelling variants within edit distance', async () => {
    const { upsertTag, findSimilarTags } = require('../../../src/backend/db/tags');
    await upsertTag('neural');
    await upsertTag('neual'); // 1 edit
    const pairs = await findSimilarTags();
    const found = pairs.some((p) =>
      [p.a.name, p.b.name].includes('neural') &&
      [p.a.name, p.b.name].includes('neual')
    );
    expect(found).toBe(true);
  });

  test('does not flag unrelated short tags as similar', async () => {
    const { upsertTag, findSimilarTags } = require('../../../src/backend/db/tags');
    await upsertTag('cat');
    await upsertTag('dog');
    const pairs = await findSimilarTags();
    const found = pairs.some((p) =>
      [p.a.name, p.b.name].includes('cat') &&
      [p.a.name, p.b.name].includes('dog')
    );
    expect(found).toBe(false);
  });
});
