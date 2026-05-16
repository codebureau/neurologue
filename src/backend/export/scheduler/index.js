'use strict';

/**
 * CCF Scheduled Export Scheduler
 *
 * Runs periodic CCF snapshots in the background.
 * Each run:
 *   1. Calls exportCCF() to produce a full snapshot in a timestamped sub-folder.
 *   2. Optionally computes a diff against the previous snapshot and writes diff.json.
 *   3. Appends a record to the export history log.
 *
 * The scheduler is driven by setInterval and respects the configured frequency
 * (daily / weekly).  It never blocks the UI.
 *
 * Public API
 * ----------
 *   startScheduler()        — start ticking (idempotent)
 *   stopScheduler()         — stop ticking
 *   runScheduledExport()    — trigger one export run immediately
 *   getExportHistory()      — return the last N history records
 *   getSchedulerStatus()    — { enabled, frequency, destDir, includeDiff, lastRun, nextRun }
 */

const fs   = require('fs');
const path = require('path');

const { exportCCF }  = require('../ccf');
const { diffCCF }    = require('../../ccf/diff');
const { getSettings, saveSettings } = require('../../settings');
const config = require('../../../config');

// ── constants ─────────────────────────────────────────────────────────────────

const HISTORY_FILE    = path.join(path.dirname(config.settings.path), 'scheduled-export-history.json');
const MAX_HISTORY     = 100;
const TICK_MS         = 60 * 1000; // check once per minute

// ── module state ──────────────────────────────────────────────────────────────

let _timer = null;

// ── history helpers ───────────────────────────────────────────────────────────

function _readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function _appendHistory(record) {
  const history = _readHistory();
  history.push(record);
  // Keep only the most recent MAX_HISTORY entries
  const trimmed = history.slice(-MAX_HISTORY);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

// ── scheduling helpers ────────────────────────────────────────────────────────

/**
 * Returns the number of milliseconds between scheduled runs for the given frequency.
 */
function _frequencyMs(frequency) {
  if (frequency === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000; // default: daily
}

/**
 * Returns true if a run is due given the last run timestamp and frequency.
 */
function _isDue(lastRunIso, frequency) {
  if (!lastRunIso) return true;
  const elapsed = Date.now() - new Date(lastRunIso).getTime();
  return elapsed >= _frequencyMs(frequency);
}

/**
 * Build a timestamped snapshot folder name, e.g. "2026-01-15T14-30-00-123Z"
 */
function _snapshotFolderName(now = new Date()) {
  return now.toISOString().replace(/:/g, '-').replace('.', '-').replace('Z', 'Z');
}

// ── core export run ───────────────────────────────────────────────────────────

/**
 * Perform one scheduled export run.
 * @param {object} [opts]
 * @param {string}  opts.destDir     Destination root folder.
 * @param {boolean} opts.includeDiff Whether to write diff.json.
 * @returns {Promise<{ ok: boolean, snapshotDir: string, diffWritten: boolean, error?: string }>}
 */
async function runScheduledExport({ destDir, includeDiff } = {}) {
  const settings = getSettings();
  const resolvedDestDir   = destDir     ?? settings.scheduledExport?.destDir;
  const resolvedDiff      = includeDiff ?? settings.scheduledExport?.includeDiff ?? false;

  if (!resolvedDestDir) {
    return { ok: false, snapshotDir: null, diffWritten: false, error: 'No destination folder configured' };
  }

  const snapshotName = _snapshotFolderName();
  const snapshotDir  = path.join(resolvedDestDir, snapshotName);

  try {
    // ── 1. Full CCF export ────────────────────────────────────────────────
    await exportCCF(snapshotDir);

    // ── 2. Optional diff against previous snapshot ────────────────────────
    let diffWritten = false;
    if (resolvedDiff) {
      const prevDir = _findPreviousSnapshot(resolvedDestDir, snapshotName);
      if (prevDir) {
        const diff = diffCCF(prevDir, snapshotDir);
        fs.writeFileSync(
          path.join(snapshotDir, 'diff.json'),
          JSON.stringify(diff, null, 2),
          'utf8',
        );
        diffWritten = true;
      }
    }

    // ── 3. Record history ─────────────────────────────────────────────────
    const record = {
      runAt:       new Date().toISOString(),
      snapshotDir,
      diffWritten,
      ok: true,
    };
    _appendHistory(record);

    // ── 4. Persist lastRun in settings ────────────────────────────────────
    saveSettings({
      scheduledExport: {
        ...(settings.scheduledExport || {}),
        lastRun: record.runAt,
      },
    });

    return { ok: true, snapshotDir, diffWritten };
  } catch (err) {
    const error = err && err.message ? err.message : String(err);
    _appendHistory({ runAt: new Date().toISOString(), snapshotDir, diffWritten: false, ok: false, error });
    return { ok: false, snapshotDir, diffWritten: false, error };
  }
}

/**
 * Find the most recent previous snapshot folder in destDir (excluding the
 * just-created one identified by currentName).
 * Returns the full path, or null if none found.
 */
function _findPreviousSnapshot(destDir, currentName) {
  if (!fs.existsSync(destDir)) return null;
  const siblings = fs.readdirSync(destDir)
    .filter((name) => name !== currentName && fs.statSync(path.join(destDir, name)).isDirectory())
    .sort(); // ISO timestamp names sort lexicographically = chronologically
  if (siblings.length === 0) return null;
  return path.join(destDir, siblings[siblings.length - 1]);
}

// ── scheduler tick ────────────────────────────────────────────────────────────

async function _tick() {
  const settings = getSettings();
  const cfg = settings.scheduledExport;
  if (!cfg || !cfg.enabled || !cfg.destDir) return;
  if (!_isDue(cfg.lastRun, cfg.frequency)) return;
  await runScheduledExport({ destDir: cfg.destDir, includeDiff: cfg.includeDiff });
}

// ── public API ────────────────────────────────────────────────────────────────

function startScheduler() {
  if (_timer) return; // idempotent
  _timer = setInterval(_tick, TICK_MS);
  // Unref so the timer doesn't prevent the Node process from exiting in tests
  if (_timer.unref) _timer.unref();
}

function stopScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

function getExportHistory(limit = MAX_HISTORY) {
  const history = _readHistory();
  return history.slice(-limit);
}

function getSchedulerStatus() {
  const settings = getSettings();
  const cfg = settings.scheduledExport || {};
  const lastRun = cfg.lastRun || null;
  let nextRun = null;
  if (cfg.enabled && cfg.destDir && lastRun) {
    nextRun = new Date(new Date(lastRun).getTime() + _frequencyMs(cfg.frequency || 'daily')).toISOString();
  }
  return {
    enabled:     cfg.enabled     ?? false,
    frequency:   cfg.frequency   ?? 'daily',
    destDir:     cfg.destDir     ?? null,
    includeDiff: cfg.includeDiff ?? false,
    lastRun,
    nextRun,
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  runScheduledExport,
  getExportHistory,
  getSchedulerStatus,
  // exported for testing
  _isDue,
  _snapshotFolderName,
  _findPreviousSnapshot,
};
