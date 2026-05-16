'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-scheduler-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;
  jest.resetModules();
  const { runMigrations } = require('../../../src/db/migrate');
  await runMigrations();
});

afterEach(() => {
  try {
    const { stopScheduler } = require('../../../src/backend/export/scheduler/index');
    stopScheduler();
  } catch { /* not loaded */ }
  try {
    const { closeDb } = require('../../../src/backend/db/connection');
    closeDb();
  } catch { /* not loaded */ }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.NEUROLOGUE_DATA_PATH;
});

// ── _isDue ────────────────────────────────────────────────────────────────────

describe('_isDue', () => {
  test('returns true when lastRun is null', () => {
    const { _isDue } = require('../../../src/backend/export/scheduler/index');
    expect(_isDue(null, 'daily')).toBe(true);
  });

  test('returns false when last run was less than 24h ago (daily)', () => {
    const { _isDue } = require('../../../src/backend/export/scheduler/index');
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    expect(_isDue(recent, 'daily')).toBe(false);
  });

  test('returns true when last run was more than 24h ago (daily)', () => {
    const { _isDue } = require('../../../src/backend/export/scheduler/index');
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    expect(_isDue(old, 'daily')).toBe(true);
  });

  test('returns false when last run was less than 7 days ago (weekly)', () => {
    const { _isDue } = require('../../../src/backend/export/scheduler/index');
    const recent = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(); // 6d ago
    expect(_isDue(recent, 'weekly')).toBe(false);
  });

  test('returns true when last run was more than 7 days ago (weekly)', () => {
    const { _isDue } = require('../../../src/backend/export/scheduler/index');
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8d ago
    expect(_isDue(old, 'weekly')).toBe(true);
  });
});

// ── _snapshotFolderName ───────────────────────────────────────────────────────

describe('_snapshotFolderName', () => {
  test('returns a string without colons', () => {
    const { _snapshotFolderName } = require('../../../src/backend/export/scheduler/index');
    const name = _snapshotFolderName(new Date('2026-01-15T14:30:00.000Z'));
    expect(name).not.toContain(':');
  });

  test('produces a valid directory name', () => {
    const { _snapshotFolderName } = require('../../../src/backend/export/scheduler/index');
    const name = _snapshotFolderName(new Date('2026-01-15T14:30:00.123Z'));
    expect(name).toBe('2026-01-15T14-30-00-123Z');
  });

  test('is deterministic for same input', () => {
    const { _snapshotFolderName } = require('../../../src/backend/export/scheduler/index');
    const d = new Date('2026-06-01T09:00:00.000Z');
    expect(_snapshotFolderName(d)).toBe(_snapshotFolderName(d));
  });
});

// ── _findPreviousSnapshot ─────────────────────────────────────────────────────

describe('_findPreviousSnapshot', () => {
  test('returns null when destDir is empty', () => {
    const { _findPreviousSnapshot } = require('../../../src/backend/export/scheduler/index');
    const dir = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(dir);
    expect(_findPreviousSnapshot(dir, '2026-01-15T14-30-00Z')).toBeNull();
  });

  test('returns null when destDir does not exist', () => {
    const { _findPreviousSnapshot } = require('../../../src/backend/export/scheduler/index');
    expect(_findPreviousSnapshot(path.join(tmpDir, 'nonexistent'), 'current')).toBeNull();
  });

  test('returns the most recent sibling snapshot folder', () => {
    const { _findPreviousSnapshot } = require('../../../src/backend/export/scheduler/index');
    const dir = path.join(tmpDir, 'snapshots');
    fs.mkdirSync(path.join(dir, '2026-01-10T12-00-00Z'), { recursive: true });
    fs.mkdirSync(path.join(dir, '2026-01-12T08-00-00Z'), { recursive: true });
    fs.mkdirSync(path.join(dir, '2026-01-14T16-00-00Z'), { recursive: true });
    const prev = _findPreviousSnapshot(dir, '2026-01-15T10-00-00Z');
    expect(prev).toBe(path.join(dir, '2026-01-14T16-00-00Z'));
  });

  test('excludes the current snapshot from consideration', () => {
    const { _findPreviousSnapshot } = require('../../../src/backend/export/scheduler/index');
    const dir = path.join(tmpDir, 'snapshots');
    const current = '2026-01-15T10-00-00Z';
    fs.mkdirSync(path.join(dir, current), { recursive: true });
    const prev = _findPreviousSnapshot(dir, current);
    expect(prev).toBeNull();
  });
});

// ── getSchedulerStatus ────────────────────────────────────────────────────────

describe('getSchedulerStatus', () => {
  test('returns defaults when no settings have been saved', () => {
    const { getSchedulerStatus } = require('../../../src/backend/export/scheduler/index');
    const status = getSchedulerStatus();
    expect(status.enabled).toBe(false);
    expect(status.frequency).toBe('daily');
    expect(status.destDir).toBeNull();
    expect(status.includeDiff).toBe(false);
    expect(status.lastRun).toBeNull();
    expect(status.nextRun).toBeNull();
  });

  test('computes nextRun when enabled with a lastRun', () => {
    const { getSchedulerStatus } = require('../../../src/backend/export/scheduler/index');
    const { saveSettings }       = require('../../../src/backend/settings');
    const lastRun = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    saveSettings({ scheduledExport: { enabled: true, frequency: 'daily', destDir: tmpDir, includeDiff: false, lastRun } });
    jest.resetModules();
    const { getSchedulerStatus: getStatus2 } = require('../../../src/backend/export/scheduler/index');
    const status = getStatus2();
    expect(status.nextRun).not.toBeNull();
    expect(new Date(status.nextRun).getTime()).toBeGreaterThan(Date.now());
  });
});

// ── runScheduledExport ────────────────────────────────────────────────────────

describe('runScheduledExport', () => {
  test('returns ok:false when no destDir configured', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const result = await runScheduledExport();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/destination/i);
  });

  test('creates a timestamped snapshot folder', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    const result = await runScheduledExport({ destDir, includeDiff: false });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(result.snapshotDir)).toBe(true);
    // Snapshot folder must be inside destDir
    expect(result.snapshotDir.startsWith(destDir)).toBe(true);
  });

  test('snapshot folder contains required CCF files', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    const { ok, snapshotDir } = await runScheduledExport({ destDir, includeDiff: false });
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, 'entries.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, 'themes.json'))).toBe(true);
    expect(fs.existsSync(path.join(snapshotDir, 'metadata.json'))).toBe(true);
  });

  test('records run in history', async () => {
    const { runScheduledExport, getExportHistory } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: false });
    const history = getExportHistory();
    expect(history.length).toBe(1);
    expect(history[0].ok).toBe(true);
  });

  test('updates lastRun in settings', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const { getSettings }        = require('../../../src/backend/settings');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: false });
    const settings = getSettings();
    expect(settings.scheduledExport.lastRun).not.toBeNull();
  });

  test('writes diff.json when includeDiff is true and a previous snapshot exists', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');

    // First run — no previous snapshot, so no diff
    const first = await runScheduledExport({ destDir, includeDiff: true });
    expect(first.ok).toBe(true);
    expect(first.diffWritten).toBe(false); // nothing to diff against

    // Second run — should diff against the first
    const second = await runScheduledExport({ destDir, includeDiff: true });
    expect(second.ok).toBe(true);
    expect(second.diffWritten).toBe(true);
    expect(fs.existsSync(path.join(second.snapshotDir, 'diff.json'))).toBe(true);
  });

  test('diff.json contains expected keys', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: true });
    const second = await runScheduledExport({ destDir, includeDiff: true });
    const diff = JSON.parse(fs.readFileSync(path.join(second.snapshotDir, 'diff.json'), 'utf8'));
    expect(diff).toHaveProperty('addedEntries');
    expect(diff).toHaveProperty('updatedEntries');
    expect(diff).toHaveProperty('deletedEntries');
    expect(diff).toHaveProperty('themeChanges');
  });

  test('does not write diff.json when includeDiff is false', async () => {
    const { runScheduledExport } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: false }); // first
    const second = await runScheduledExport({ destDir, includeDiff: false });
    expect(second.diffWritten).toBe(false);
    expect(fs.existsSync(path.join(second.snapshotDir, 'diff.json'))).toBe(false);
  });
});

// ── getExportHistory ──────────────────────────────────────────────────────────

describe('getExportHistory', () => {
  test('returns empty array before any runs', () => {
    const { getExportHistory } = require('../../../src/backend/export/scheduler/index');
    expect(getExportHistory()).toEqual([]);
  });

  test('respects limit parameter', async () => {
    const { runScheduledExport, getExportHistory } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: false });
    await runScheduledExport({ destDir, includeDiff: false });
    await runScheduledExport({ destDir, includeDiff: false });
    expect(getExportHistory(2).length).toBe(2);
  });

  test('most recent records are last in the array', async () => {
    const { runScheduledExport, getExportHistory } = require('../../../src/backend/export/scheduler/index');
    const destDir = path.join(tmpDir, 'exports');
    await runScheduledExport({ destDir, includeDiff: false });
    await runScheduledExport({ destDir, includeDiff: false });
    const history = getExportHistory();
    expect(new Date(history[0].runAt).getTime())
      .toBeLessThanOrEqual(new Date(history[1].runAt).getTime());
  });
});

// ── startScheduler / stopScheduler ───────────────────────────────────────────

describe('startScheduler / stopScheduler', () => {
  test('startScheduler is idempotent', () => {
    const { startScheduler, stopScheduler } = require('../../../src/backend/export/scheduler/index');
    expect(() => {
      startScheduler();
      startScheduler(); // second call must not throw
      stopScheduler();
    }).not.toThrow();
  });

  test('stopScheduler is safe when scheduler was never started', () => {
    const { stopScheduler } = require('../../../src/backend/export/scheduler/index');
    expect(() => stopScheduler()).not.toThrow();
  });
});
