'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { randomUUID } = require('crypto');

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-agents-'));
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

async function seedEntry(content, createdAt, category = null) {
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO entries (id, content, source, type, metadata, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, content, 'manual', 'note', '{}', createdAt, category);
  return id;
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
  db.prepare('INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)').run(themeId, entryId, 0.9);
}

// ── getWeekSummaryData ────────────────────────────────────────────────────────

describe('getWeekSummaryData', () => {
  test('returns empty entries when DB is empty', async () => {
    const { getWeekSummaryData } = require('../../../src/backend/db/agents');
    const { entries } = await getWeekSummaryData();
    expect(entries).toEqual([]);
  });

  test('returns entries from last 7 days', async () => {
    const { getWeekSummaryData } = require('../../../src/backend/db/agents');
    await seedEntry('Recent note', new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10));
    const { entries } = await getWeekSummaryData();
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe('Recent note');
  });

  test('does not return entries older than 7 days', async () => {
    const { getWeekSummaryData } = require('../../../src/backend/db/agents');
    await seedEntry('Old note', '2020-01-01 10:00:00');
    const { entries } = await getWeekSummaryData();
    expect(entries).toEqual([]);
  });
});

// ── getOpenTasksData ──────────────────────────────────────────────────────────

describe('getOpenTasksData', () => {
  test('returns empty array when no tasks exist', async () => {
    const { getOpenTasksData } = require('../../../src/backend/db/agents');
    const { tasks } = await getOpenTasksData();
    expect(tasks).toEqual([]);
  });

  test('returns only Task-category entries', async () => {
    const { getOpenTasksData } = require('../../../src/backend/db/agents');
    await seedEntry('Buy milk', '2026-05-10 10:00:00', 'Task');
    await seedEntry('Just a thought', '2026-05-10 10:00:00', 'Thought');
    const { tasks } = await getOpenTasksData();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content).toBe('Buy milk');
  });

  test('returns tasks ordered newest first', async () => {
    const { getOpenTasksData } = require('../../../src/backend/db/agents');
    await seedEntry('Old task', '2026-01-01 10:00:00', 'Task');
    await seedEntry('New task', '2026-05-10 10:00:00', 'Task');
    const { tasks } = await getOpenTasksData();
    expect(tasks[0].content).toBe('New task');
    expect(tasks[1].content).toBe('Old task');
  });
});

// ── getEmergingPrioritiesData ────────────────────────────────────────────────

describe('getEmergingPrioritiesData', () => {
  test('returns empty themes when DB has no entries', async () => {
    const { getEmergingPrioritiesData } = require('../../../src/backend/db/agents');
    const { themes } = await getEmergingPrioritiesData();
    expect(themes).toEqual([]);
  });

  test('returns theme with recent entry count', async () => {
    const { getEmergingPrioritiesData } = require('../../../src/backend/db/agents');
    const e = await seedEntry('This week', new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10));
    const t = await seedTheme('Active Theme');
    await linkEntryToTheme(e, t);
    const { themes } = await getEmergingPrioritiesData();
    expect(themes).toHaveLength(1);
    expect(themes[0].recent_count).toBe(1);
    expect(themes[0].prev_count).toBe(0);
  });

  test('theme with only old entries has zero recent_count', async () => {
    const { getEmergingPrioritiesData } = require('../../../src/backend/db/agents');
    const e = await seedEntry('Old entry', '2020-01-01 10:00:00');
    const t = await seedTheme('Old Theme');
    await linkEntryToTheme(e, t);
    const { themes } = await getEmergingPrioritiesData();
    // Theme has entries but zero in recent windows — should still appear (total_count > 0)
    // but with recent_count = 0 and prev_count = 0
    const found = themes.find((th) => th.recent_count === 0 && th.prev_count === 0);
    expect(found).toBeDefined();
  });
});

// ── getTodayFocusData ────────────────────────────────────────────────────────

describe('getTodayFocusData', () => {
  test('returns empty arrays when DB is empty', async () => {
    const { getTodayFocusData } = require('../../../src/backend/db/agents');
    const result = await getTodayFocusData();
    expect(result.recentEntries).toEqual([]);
    expect(result.openTasks).toEqual([]);
    expect(result.topThemes).toEqual([]);
  });

  test('includes recent entries and open tasks', async () => {
    const { getTodayFocusData } = require('../../../src/backend/db/agents');
    await seedEntry('Recent thought', new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10), 'Thought');
    await seedEntry('Pending task', new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10), 'Task');
    const result = await getTodayFocusData();
    expect(result.recentEntries.length).toBeGreaterThanOrEqual(1);
    expect(result.openTasks.length).toBe(1);
    expect(result.openTasks[0].content).toBe('Pending task');
  });

  test('does not include entries older than 7 days in recentEntries', async () => {
    const { getTodayFocusData } = require('../../../src/backend/db/agents');
    await seedEntry('Old thought', '2020-01-01 10:00:00', 'Thought');
    const result = await getTodayFocusData();
    expect(result.recentEntries).toEqual([]);
  });
});
