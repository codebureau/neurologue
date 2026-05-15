'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { randomUUID } = require('crypto');

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-replay-'));
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

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedEntryAt(content, createdAt, category = null) {
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO entries (id, content, source, type, metadata, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, content, 'manual', 'note', '{}', createdAt, category);
  return { id, content, created_at: createdAt, category };
}

async function seedTheme(name = 'Test Theme') {
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  const id = randomUUID();
  db.prepare('INSERT INTO themes (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

async function linkEntryToTheme(entryId, themeId) {
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  db.prepare(
    'INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)'
  ).run(themeId, entryId, 0.9);
}

// ── listActiveMonths ──────────────────────────────────────────────────────────

describe('listActiveMonths', () => {
  test('returns empty array when no entries exist', async () => {
    const { listActiveMonths } = require('../../../src/backend/db/replay');
    const months = await listActiveMonths();
    expect(months).toEqual([]);
  });

  test('returns one month entry for a single entry', async () => {
    const { listActiveMonths } = require('../../../src/backend/db/replay');
    await seedEntryAt('Hello', '2026-03-15 10:00:00');
    const months = await listActiveMonths();
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ year: 2026, month: 3, count: 1 });
  });

  test('groups multiple entries in the same month together', async () => {
    const { listActiveMonths } = require('../../../src/backend/db/replay');
    await seedEntryAt('A', '2026-03-01 10:00:00');
    await seedEntryAt('B', '2026-03-20 10:00:00');
    const months = await listActiveMonths();
    expect(months).toHaveLength(1);
    expect(months[0].count).toBe(2);
  });

  test('returns months in descending order (newest first)', async () => {
    const { listActiveMonths } = require('../../../src/backend/db/replay');
    await seedEntryAt('A', '2026-01-15 10:00:00');
    await seedEntryAt('B', '2026-03-15 10:00:00');
    const months = await listActiveMonths();
    expect(months[0].month).toBe(3);
    expect(months[1].month).toBe(1);
  });
});

// ── getMonthSnapshot ──────────────────────────────────────────────────────────

describe('getMonthSnapshot', () => {
  test('returns zero entries for a month with no data', async () => {
    const { getMonthSnapshot } = require('../../../src/backend/db/replay');
    const snap = await getMonthSnapshot(2026, 1);
    expect(snap.entryCount).toBe(0);
    expect(snap.entries).toEqual([]);
    expect(snap.topThemes).toEqual([]);
  });

  test('returns only entries from the requested month', async () => {
    const { getMonthSnapshot } = require('../../../src/backend/db/replay');
    await seedEntryAt('March entry', '2026-03-10 10:00:00');
    await seedEntryAt('April entry', '2026-04-05 10:00:00');
    const snap = await getMonthSnapshot(2026, 3);
    expect(snap.entryCount).toBe(1);
    expect(snap.entries[0].content).toBe('March entry');
  });

  test('includes top themes active in that month', async () => {
    const { getMonthSnapshot } = require('../../../src/backend/db/replay');
    const e  = await seedEntryAt('Entry', '2026-03-10 10:00:00');
    const t  = await seedTheme('March Theme');
    await linkEntryToTheme(e.id, t);
    const snap = await getMonthSnapshot(2026, 3);
    expect(snap.topThemes).toHaveLength(1);
    expect(snap.topThemes[0].display_name).toBe('March Theme');
  });

  test('does not include themes with no entries in that month', async () => {
    const { getMonthSnapshot } = require('../../../src/backend/db/replay');
    await seedTheme('Orphan Theme'); // no entries
    const snap = await getMonthSnapshot(2026, 3);
    expect(snap.topThemes).toHaveLength(0);
  });
});

// ── comparePeriods ────────────────────────────────────────────────────────────

describe('comparePeriods', () => {
  test('returns empty sets for periods with no entries', async () => {
    const { comparePeriods } = require('../../../src/backend/db/replay');
    const result = await comparePeriods('2026-01-01', '2026-02-01', '2026-02-01', '2026-03-01');
    expect(result.period1.themes).toEqual([]);
    expect(result.period2.themes).toEqual([]);
    expect(result.gained).toEqual([]);
    expect(result.lost).toEqual([]);
    expect(result.common).toEqual([]);
  });

  test('identifies themes gained in period 2', async () => {
    const { comparePeriods } = require('../../../src/backend/db/replay');
    const e  = await seedEntryAt('New idea', '2026-02-15 10:00:00');
    const t  = await seedTheme('New Theme');
    await linkEntryToTheme(e.id, t);
    const result = await comparePeriods('2026-01-01', '2026-02-01', '2026-02-01', '2026-03-01');
    expect(result.gained).toHaveLength(1);
    expect(result.gained[0].id).toBe(t);
    expect(result.lost).toHaveLength(0);
  });

  test('identifies themes lost from period 1', async () => {
    const { comparePeriods } = require('../../../src/backend/db/replay');
    const e  = await seedEntryAt('Old idea', '2026-01-15 10:00:00');
    const t  = await seedTheme('Old Theme');
    await linkEntryToTheme(e.id, t);
    const result = await comparePeriods('2026-01-01', '2026-02-01', '2026-02-01', '2026-03-01');
    expect(result.lost).toHaveLength(1);
    expect(result.lost[0].id).toBe(t);
    expect(result.gained).toHaveLength(0);
  });

  test('identifies themes common to both periods', async () => {
    const { comparePeriods } = require('../../../src/backend/db/replay');
    const e1 = await seedEntryAt('January', '2026-01-15 10:00:00');
    const e2 = await seedEntryAt('February', '2026-02-15 10:00:00');
    const t  = await seedTheme('Persistent Theme');
    await linkEntryToTheme(e1.id, t);
    await linkEntryToTheme(e2.id, t);
    const result = await comparePeriods('2026-01-01', '2026-02-01', '2026-02-01', '2026-03-01');
    expect(result.common).toHaveLength(1);
    expect(result.common[0].id).toBe(t);
    expect(result.lost).toHaveLength(0);
    expect(result.gained).toHaveLength(0);
  });
});

// ── getAbandonedIdeas ─────────────────────────────────────────────────────────

describe('getAbandonedIdeas', () => {
  test('returns empty array when there are no ideas', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    const ideas = await getAbandonedIdeas();
    expect(ideas).toEqual([]);
  });

  test('returns old idea-category entries', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    // Entry created 60 days ago with category Idea
    await seedEntryAt('Old idea', '2026-03-16 10:00:00', 'Idea'); // 60 days before May 15
    const ideas = await getAbandonedIdeas(30);
    expect(ideas).toHaveLength(1);
    expect(ideas[0].content).toBe('Old idea');
  });

  test('does not return recent entries (within threshold)', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    // Entry created 5 days ago — should NOT be returned
    await seedEntryAt('Recent idea', '2026-05-10 10:00:00', 'Idea');
    const ideas = await getAbandonedIdeas(30);
    expect(ideas).toHaveLength(0);
  });

  test('does not return non-idea categories', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    await seedEntryAt('Old task', '2026-03-16 10:00:00', 'Task');
    await seedEntryAt('Old thought', '2026-03-16 10:00:00', 'Thought');
    const ideas = await getAbandonedIdeas(30);
    expect(ideas).toHaveLength(0);
  });

  test('includes Question and Decision categories', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    await seedEntryAt('Old question', '2026-03-16 10:00:00', 'Question');
    await seedEntryAt('Old decision', '2026-03-16 10:00:00', 'Decision');
    const ideas = await getAbandonedIdeas(30);
    expect(ideas).toHaveLength(2);
  });

  test('excludes entries belonging to recently-active themes', async () => {
    const { getAbandonedIdeas } = require('../../../src/backend/db/replay');
    const e = await seedEntryAt('Old idea in active theme', '2026-03-16 10:00:00', 'Idea');
    const t = await seedTheme('Active Theme');
    await linkEntryToTheme(e.id, t);
    // Add a recent entry to the same theme (makes it active)
    const recent = await seedEntryAt('Recent in same theme', '2026-05-10 10:00:00');
    await linkEntryToTheme(recent.id, t);
    const ideas = await getAbandonedIdeas(30);
    // e should be excluded because its theme has recent activity
    expect(ideas.find((i) => i.id === e.id)).toBeUndefined();
  });
});
