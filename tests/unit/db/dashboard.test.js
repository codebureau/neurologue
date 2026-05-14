'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-dash-'));
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

async function seedEntry(content = 'Hello world') {
  const { createEntry } = require('../../../src/backend/db/entries');
  return createEntry({ content });
}

async function seedTheme(name = 'Test Theme') {
  const { randomUUID } = require('crypto');
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  const id = randomUUID();
  db.prepare('INSERT INTO themes (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

describe('getDashboardSummary', () => {
  test('returns zeros for an empty database', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    const summary = await getDashboardSummary();
    expect(summary.totalEntries).toBe(0);
    expect(summary.weeklyEntryCount).toBe(0);
    expect(summary.openLoopCount).toBe(0);
    expect(summary.contradictionCount).toBe(0);
    expect(summary.recentCaptures).toEqual([]);
    expect(summary.thoughtDensity).toEqual([]);
    expect(summary.activeThemes).toEqual([]);
    expect(summary.emergingThemes).toEqual([]);
    expect(summary.openLoopEntries).toEqual([]);
  });

  test('counts total entries and recent captures', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    await seedEntry('Entry one');
    await seedEntry('Entry two');
    const summary = await getDashboardSummary();
    expect(summary.totalEntries).toBe(2);
    expect(summary.recentCaptures).toHaveLength(2);
    expect(summary.weeklyEntryCount).toBe(2);
  });

  test('counts active contradictions', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    const e1 = await seedEntry('Contradiction A');
    const e2 = await seedEntry('Contradiction B');
    const { randomUUID } = require('crypto');
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    // canonical order: lexicographically smaller id first
    const [a, b] = [e1.id, e2.id].sort();
    db.prepare(
      "INSERT INTO contradictions (id, entry_a_id, entry_b_id, status) VALUES (?, ?, ?, 'active')"
    ).run(randomUUID(), a, b);
    const summary = await getDashboardSummary();
    expect(summary.contradictionCount).toBe(1);
  });

  test('counts open loops from entry_signals', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    const entry = await seedEntry('I need to finish this task…');
    const themeId = await seedTheme();
    const { upsertEntrySignals } = require('../../../src/backend/db/entry_signals');
    await upsertEntrySignals({
      entry_id: entry.id,
      theme_id: themeId,
      length_tokens: 8,
      sentiment_score: 0.1,
      emotional_intensity: 0.3,
      obligation_flag: 1,
      motivation_flag: 0,
      value_reference_flag: 0,
      open_loop_flag: 1,
    });
    const summary = await getDashboardSummary();
    expect(summary.openLoopCount).toBe(1);
    expect(summary.openLoopEntries).toHaveLength(1);
    expect(summary.openLoopEntries[0].id).toBe(entry.id);
  });

  test('identifies emerging themes (first entry today)', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    const entry = await seedEntry('New theme entry');
    const themeId = await seedTheme('Brand New Theme');
    const { openDb } = require('../../../src/backend/db/connection');
    const db = await openDb();
    db.prepare('INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)').run(themeId, entry.id, 1.0);
    const summary = await getDashboardSummary();
    expect(summary.emergingThemes.length).toBeGreaterThanOrEqual(1);
    const found = summary.emergingThemes.find((t) => t.id === themeId);
    expect(found).toBeDefined();
    expect(found.display_name).toBe('Brand New Theme');
  });

  test('returns correct shape for all fields', async () => {
    const { getDashboardSummary } = require('../../../src/backend/db/dashboard');
    const summary = await getDashboardSummary();
    expect(summary).toMatchObject({
      totalEntries:       expect.any(Number),
      weeklyEntryCount:   expect.any(Number),
      openLoopCount:      expect.any(Number),
      contradictionCount: expect.any(Number),
      recentCaptures:     expect.any(Array),
      thoughtDensity:     expect.any(Array),
      activeThemes:       expect.any(Array),
      emergingThemes:     expect.any(Array),
      openLoopEntries:    expect.any(Array),
    });
  });
});
