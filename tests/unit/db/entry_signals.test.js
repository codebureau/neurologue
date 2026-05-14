'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-signals-'));
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

async function makeEntry(content = 'test entry') {
  const { createEntry } = require('../../../src/backend/db/entries');
  return createEntry({ content });
}

function baseSignals(entryId) {
  return {
    entry_id:            entryId,
    theme_id:            null,
    length_tokens:       50,
    sentiment_score:     0.5,
    emotional_intensity: 0.3,
    obligation_flag:     false,
    motivation_flag:     true,
    value_reference_flag: false,
    open_loop_flag:      false,
  };
}

describe('upsertEntrySignals / getEntrySignals', () => {
  test('stores and retrieves signals', async () => {
    const { upsertEntrySignals, getEntrySignals } = require('../../../src/backend/db/entry_signals');
    const entry = await makeEntry();
    await upsertEntrySignals(baseSignals(entry.id));
    const row = await getEntrySignals(entry.id);
    expect(row).toBeDefined();
    expect(row.entry_id).toBe(entry.id);
    expect(row.sentiment_score).toBeCloseTo(0.5);
    expect(row.motivation_flag).toBe(1);
    expect(row.obligation_flag).toBe(0);
    expect(row.length_tokens).toBe(50);
  });

  test('overwrites existing row on conflict', async () => {
    const { upsertEntrySignals, getEntrySignals } = require('../../../src/backend/db/entry_signals');
    const entry = await makeEntry();
    await upsertEntrySignals(baseSignals(entry.id));
    await upsertEntrySignals({ ...baseSignals(entry.id), sentiment_score: -0.8, length_tokens: 100 });
    const row = await getEntrySignals(entry.id);
    expect(row.sentiment_score).toBeCloseTo(-0.8);
    expect(row.length_tokens).toBe(100);
  });

  test('returns undefined for unknown entry_id', async () => {
    const { getEntrySignals } = require('../../../src/backend/db/entry_signals');
    const row = await getEntrySignals('00000000-0000-0000-0000-000000000000');
    expect(row).toBeUndefined();
  });
});

describe('getSignalsByTheme', () => {
  test('returns signals for entries in a theme', async () => {
    const { upsertEntrySignals, getSignalsByTheme } = require('../../../src/backend/db/entry_signals');
    const e1 = await makeEntry('entry one');
    const e2 = await makeEntry('entry two');
    const themeId = 'theme-abc';
    await upsertEntrySignals({ ...baseSignals(e1.id), theme_id: themeId });
    await upsertEntrySignals({ ...baseSignals(e2.id), theme_id: themeId });
    await upsertEntrySignals(baseSignals((await makeEntry('no theme')).id));
    const rows = await getSignalsByTheme(themeId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.entry_id)).toContain(e1.id);
    expect(rows.map((r) => r.entry_id)).toContain(e2.id);
  });

  test('returns empty array when theme has no signals', async () => {
    const { getSignalsByTheme } = require('../../../src/backend/db/entry_signals');
    const rows = await getSignalsByTheme('nonexistent-theme');
    expect(rows).toEqual([]);
  });
});

describe('listEntriesWithoutSignals', () => {
  test('returns entries that have no signals', async () => {
    const { upsertEntrySignals, listEntriesWithoutSignals } = require('../../../src/backend/db/entry_signals');
    const e1 = await makeEntry('needs signals');
    const e2 = await makeEntry('has signals');
    await upsertEntrySignals(baseSignals(e2.id));
    const pending = await listEntriesWithoutSignals();
    expect(pending).toContain(e1.id);
    expect(pending).not.toContain(e2.id);
  });

  test('respects the limit parameter', async () => {
    const { listEntriesWithoutSignals } = require('../../../src/backend/db/entry_signals');
    await makeEntry('a'); await makeEntry('b'); await makeEntry('c');
    const pending = await listEntriesWithoutSignals(2);
    expect(pending).toHaveLength(2);
  });

  test('returns empty array when all entries have signals', async () => {
    const { upsertEntrySignals, listEntriesWithoutSignals } = require('../../../src/backend/db/entry_signals');
    const entry = await makeEntry();
    await upsertEntrySignals(baseSignals(entry.id));
    expect(await listEntriesWithoutSignals()).toEqual([]);
  });
});
