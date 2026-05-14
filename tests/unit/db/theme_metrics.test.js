'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;
beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-tm-'));
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

function baseMetrics(themeId, windowOffset = 0) {
  const start = new Date(Date.now() - (30 + windowOffset) * 86400000).toISOString();
  const end   = new Date(Date.now() + windowOffset * 86400000).toISOString();
  return {
    theme_id:              themeId,
    window_start:          start,
    window_end:            end,
    energy_score:          0.7,
    value_alignment_score: 0.6,
    obligation_score:      0.4,
    motivation_score:      0.5,
    priority_score:        0.58,
    open_loops_count:      2,
    entries_count:         5,
  };
}

async function makeTheme(name = 'Test Theme') {
  const { randomUUID } = require('crypto');
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  const id = randomUUID();
  db.prepare("INSERT INTO themes (id, name, user_name) VALUES (?, ?, ?)")
    .run(id, name, name);
  return id;
}

describe('upsertThemeMetrics / getLatestThemeMetrics', () => {
  test('stores and retrieves theme metrics', async () => {
    const { upsertThemeMetrics, getLatestThemeMetrics } = require('../../../src/backend/db/theme_metrics');
    const themeId = await makeTheme();
    const metrics = baseMetrics(themeId);
    await upsertThemeMetrics(metrics);
    const row = await getLatestThemeMetrics(themeId);
    expect(row).toBeDefined();
    expect(row.theme_id).toBe(themeId);
    expect(row.energy_score).toBeCloseTo(0.7);
    expect(row.priority_score).toBeCloseTo(0.58);
    expect(row.open_loops_count).toBe(2);
    expect(row.entries_count).toBe(5);
  });

  test('updates existing row on conflict (same theme+window)', async () => {
    const { upsertThemeMetrics, getLatestThemeMetrics } = require('../../../src/backend/db/theme_metrics');
    const themeId = await makeTheme();
    const m = baseMetrics(themeId);
    await upsertThemeMetrics(m);
    await upsertThemeMetrics({ ...m, energy_score: 0.9, priority_score: 0.8 });
    const row = await getLatestThemeMetrics(themeId);
    expect(row.energy_score).toBeCloseTo(0.9);
    expect(row.priority_score).toBeCloseTo(0.8);
  });

  test('returns undefined for unknown theme', async () => {
    const { getLatestThemeMetrics } = require('../../../src/backend/db/theme_metrics');
    const row = await getLatestThemeMetrics('no-such-theme');
    expect(row).toBeUndefined();
  });
});

describe('listLatestThemeMetrics', () => {
  test('returns one row per theme, ordered by priority_score DESC', async () => {
    const { upsertThemeMetrics, listLatestThemeMetrics } = require('../../../src/backend/db/theme_metrics');
    const t1 = await makeTheme('Theme A');
    const t2 = await makeTheme('Theme B');
    await upsertThemeMetrics({ ...baseMetrics(t1), priority_score: 0.3 });
    await upsertThemeMetrics({ ...baseMetrics(t2), priority_score: 0.8 });
    const rows = await listLatestThemeMetrics();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((r) => r.theme_id);
    expect(ids).toContain(t1);
    expect(ids).toContain(t2);
    // Higher priority first
    const idxT2 = ids.indexOf(t2);
    const idxT1 = ids.indexOf(t1);
    expect(idxT2).toBeLessThan(idxT1);
  });
});

describe('getThemeMetricsHistory', () => {
  test('returns multiple rows for a theme in window_start ASC order', async () => {
    const { upsertThemeMetrics, getThemeMetricsHistory } = require('../../../src/backend/db/theme_metrics');
    const themeId = await makeTheme();
    // Two non-overlapping windows
    const m1 = baseMetrics(themeId, 0);
    const m2 = baseMetrics(themeId, 5);
    await upsertThemeMetrics(m1);
    await upsertThemeMetrics(m2);
    const rows = await getThemeMetricsHistory(themeId);
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].window_start).getTime())
      .toBeLessThanOrEqual(new Date(rows[1].window_start).getTime());
  });

  test('returns empty array for unknown theme', async () => {
    const { getThemeMetricsHistory } = require('../../../src/backend/db/theme_metrics');
    expect(await getThemeMetricsHistory('no-such-theme')).toEqual([]);
  });
});
