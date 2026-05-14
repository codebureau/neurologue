'use strict';

/**
 * Background embedding worker.
 *
 * Polls for entries that have no embedding, generates vectors via Ollama,
 * and stores them in both SQLite (embeddings table) and LanceDB.
 *
 * Runs entirely in the main process as a recurring async task.
 * Never blocks the UI — all operations are async with await.
 */

const { listEntriesWithoutEmbedding, upsertEmbedding, deleteEmbedding, clearAllEmbeddings } = require('../backend/db/embeddings');
const { getEntryById, updateEntryCategory, listEntriesWithoutCategory } = require('../backend/db/entries');
const { upsertVector, deleteVector, clearAllVectors } = require('../backend/vector/store');
const { generateEmbedding, isOllamaAvailable, getOllamaStatus, classifyEntry, detectContradiction, computeEntrySignals } = require('./ollama');
const { runClustering } = require('../backend/clustering/themes');
const { createContradiction, pairExists } = require('../backend/db/contradictions');
const { upsertEntrySignals, listEntriesWithoutSignals } = require('../backend/db/entry_signals');
const { upsertThemeMetrics, recomputeAllThemeMetrics } = require('../backend/db/theme_metrics');
const { getSettings } = require('../backend/settings');
const config = require('../config');

const BATCH_SIZE = 5;            // process up to 5 entries per tick
const CLASSIFY_BATCH_SIZE = 3;   // classify up to 3 already-embedded entries per tick
const SIGNALS_BATCH_SIZE = 3;    // compute signals for up to 3 entries per tick
// Re-cluster after this many new embeddings are added in one session
const CLUSTER_AFTER = 5;
// Maximum contradiction pairs to check per scan pass
const CONTRADICTION_MAX_PAIRS = 15;
// Max entries in the in-memory task log
const LOG_MAX = 100;

let _timer = null;
let _running = false;
let _paused = false;
let _embeddedSinceCluster = 0;
let _queueLength = 0;          // entries pending embedding
let _classifyQueueLength = 0;  // entries pending classification
let _lastProcessed = null; // ISO timestamp of last successfully embedded entry
let _webContents = null;  // set by setMainWindow() once the library window opens
let _lastContradictionScan = null; // ISO timestamp of last contradiction scan

// ── Configurable intervals (seconds) — updated via setWorkerIntervals() ──
let _intervals = {
  embedding:     60,
  clustering:    300,
  contradiction: 900,
};
// Countdown accumulators (ticks remaining before next run)
let _ticksUntilCluster      = 0; // run immediately after enough embeddings
let _ticksUntilContradiction = 0;

// ── Task activity log ─────────────────────────────────────────────────────
/** @type {{ task: string, startedAt: string, completedAt: string|null, durationMs: number|null, status: 'running'|'success'|'error', message: string }[]} */
const _taskLog = [];
let _currentTask = null; // { task, startedAt }

function _logStart(task) {
  const entry = { task, startedAt: new Date().toISOString(), completedAt: null, durationMs: null, status: 'running', message: '' };
  _taskLog.push(entry);
  if (_taskLog.length > LOG_MAX) _taskLog.shift();
  _currentTask = entry;
  _push('worker:task-started', { task });
  return entry;
}

function _logEnd(entry, status, message = '') {
  entry.completedAt = new Date().toISOString();
  entry.durationMs = Date.now() - new Date(entry.startedAt).getTime();
  entry.status = status;
  entry.message = message;
  _currentTask = null;
  _push('worker:task-completed', { task: entry.task, status, message, durationMs: entry.durationMs });
}

// Push a channel + payload to the renderer (silently no-ops if window not ready)
function _push(channel, payload) {
  if (_webContents && !_webContents.isDestroyed()) {
    _webContents.send(channel, payload);
  }
}

/**
 * Apply new interval settings (seconds). Restarts the poll timer.
 * @param {{ embedding?: number, clustering?: number, contradiction?: number }} intervals
 */
function setWorkerIntervals(intervals = {}) {
  const prev = _intervals.embedding;
  _intervals = {
    embedding:     (intervals.embedding     || 60),
    clustering:    (intervals.clustering    || 300),
    contradiction: (intervals.contradiction || 900),
  };
  // If embedding interval changed, restart the timer
  if (_running && _intervals.embedding !== prev) {
    clearInterval(_timer);
    _timer = setInterval(() => {
      processBatch().catch((e) => console.error('[worker] Unexpected error:', e.message));
    }, _intervals.embedding * 1000);
    if (_timer.unref) _timer.unref();
  }
  console.log(`[worker] Intervals updated — embed:${_intervals.embedding}s cluster:${_intervals.clustering}s contradiction:${_intervals.contradiction}s`);
}

// ── Core processing ───────────────────────────────────────────────────────

async function processBatch() {
  if (_paused) return;

  const available = await isOllamaAvailable();
  if (!available) {
    console.log('[worker] Ollama not available — skipping tick');
    _push('worker:status', await _buildStatus(false));
    return;
  }

  // ── Pass 1: embed entries that have no embedding yet ──────────────────
  const entryIds = await listEntriesWithoutEmbedding();
  _queueLength = entryIds.length;
  _push('worker:status', await _buildStatus(true));

  const batch = entryIds.slice(0, BATCH_SIZE);
  const embedLog = _logStart('embedding');
  if (batch.length > 0) {
    console.log(`[worker] Embedding ${batch.length} of ${entryIds.length} pending entries`);
    let newEmbeddings = 0;
    let embedErrors = 0;
    for (const id of batch) {
      try {
        const entry = await getEntryById(id);
        if (!entry) continue;

        const vector    = await generateEmbedding(entry.content);
        const modelName = getSettings().embeddingModel;

        await upsertEmbedding(id, vector, modelName);
        await upsertVector(id, vector, modelName);

        // Classify entry if not already categorised — fire-and-forget
        if (!entry.category) {
          Promise.resolve()
            .then(() => classifyEntry(entry.content))
            .then((category) => updateEntryCategory(id, category, 'llm'))
            .catch((err) => console.warn(`[worker] Classification failed for ${id.slice(0, 8)}…: ${err.message}`));
        }

        console.log(`[worker] Embedded entry ${id.slice(0, 8)}…`);
        _embeddedSinceCluster++;
        _lastProcessed = new Date().toISOString();
        _queueLength = Math.max(0, _queueLength - 1);
        newEmbeddings++;
      } catch (err) {
        embedErrors++;
        console.error(`[worker] Failed to embed entry ${id.slice(0, 8)}…: ${err.message}`);
      }
    }
    const embedMsg = embedErrors > 0
      ? `${newEmbeddings} embedded, ${embedErrors} failed`
      : `${newEmbeddings} embedded`;
    _logEnd(embedLog, embedErrors > 0 && newEmbeddings === 0 ? 'error' : 'success', embedMsg);

    if (newEmbeddings > 0) {
      _push('worker:entries-updated', {});
    }
  } else {
    _logEnd(embedLog, 'success', 'queue empty');
  }

  // ── Pass 2: classify entries that are embedded but have no category ───
  const unclassifiedIds = await listEntriesWithoutCategory(CLASSIFY_BATCH_SIZE);
  _classifyQueueLength = unclassifiedIds.length;
  _push('worker:status', await _buildStatus(true));

  const classLog = _logStart('classification');
  if (unclassifiedIds.length > 0) {
    let newCategories = 0;
    let classErrors = 0;
    for (const id of unclassifiedIds) {
      try {
        const entry = await getEntryById(id);
        if (!entry) continue;
        const category = await classifyEntry(entry.content);
        await updateEntryCategory(id, category, 'llm');
        console.log(`[worker] Classified entry ${id.slice(0, 8)}… → ${category}`);
        newCategories++;
      } catch (err) {
        classErrors++;
        console.warn(`[worker] Classification failed for ${id.slice(0, 8)}…: ${err.message}`);
      }
    }
    _classifyQueueLength = 0;
    _logEnd(classLog, classErrors > 0 && newCategories === 0 ? 'error' : 'success',
      `${newCategories} classified${classErrors > 0 ? `, ${classErrors} failed` : ''}`);

    if (newCategories > 0) {
      _push('worker:entries-updated', {});
    }
  } else {
    _logEnd(classLog, 'success', 'queue empty');
  }

  // ── Pass 3: compute entry signals for entries that have none yet ──────
  const signalIds = await listEntriesWithoutSignals(SIGNALS_BATCH_SIZE);
  const signalLog = _logStart('signals');
  if (signalIds.length > 0) {
    let signalsDone = 0;
    let signalErrors = 0;
    for (const id of signalIds) {
      try {
        const entry = await getEntryById(id);
        if (!entry) continue;
        const signals = await computeEntrySignals(entry.content);
        // Simple token count: split on whitespace
        const lengthTokens = entry.content.trim().split(/\s+/).length;
        await upsertEntrySignals({ entry_id: id, ...signals, length_tokens: lengthTokens });
        signalsDone++;
      } catch (err) {
        signalErrors++;
        console.warn(`[worker] Signal computation failed for ${id.slice(0, 8)}…: ${err.message}`);
      }
    }
    _logEnd(signalLog,
      signalErrors > 0 && signalsDone === 0 ? 'error' : 'success',
      `${signalsDone} signals${signalErrors > 0 ? `, ${signalErrors} failed` : ''}`);
  } else {
    _logEnd(signalLog, 'success', 'queue empty');
  }

  // ── Clustering (time-based interval + after enough new embeddings) ─────
  _ticksUntilCluster--;
  const shouldCluster = _embeddedSinceCluster >= CLUSTER_AFTER || _ticksUntilCluster <= 0;
  if (shouldCluster) {
    _embeddedSinceCluster = 0;
    _ticksUntilCluster = Math.round(_intervals.clustering / _intervals.embedding);
    let clusteringRan = false;
    const clusterLog = _logStart('clustering');
    try {
      const result = await runClustering();
      if (result.skipped) {
        console.log(`[worker] Clustering skipped: ${result.reason}`);
        _logEnd(clusterLog, 'success', `skipped — ${result.reason}`);
      } else {
        console.log(`[worker] Clustering complete — ${result.themes} themes`);
        _logEnd(clusterLog, 'success', `${result.themes} themes`);
        _push('worker:themes-updated', {});
        clusteringRan = true;

        // Recompute ThemeMetrics now that clusters are fresh
        recomputeAllThemeMetrics()
          .then((n) => console.log(`[worker] ThemeMetrics updated for ${n} themes`))
          .catch((err) => console.warn('[worker] ThemeMetrics recompute failed:', err.message));
      }
    } catch (err) {
      console.error('[worker] Clustering error:', err.message);
      _logEnd(clusterLog, 'error', err.message);
    }

    // Contradiction scan after clustering (themes are fresh), also on its own interval
    _ticksUntilContradiction--;
    if (clusteringRan || _ticksUntilContradiction <= 0) {
      _ticksUntilContradiction = Math.round(_intervals.contradiction / _intervals.embedding);
      const contLog = _logStart('contradiction-scan');
      try {
        const cResult = await scanContradictions();
        console.log(`[worker] Contradiction scan: ${cResult.found} new, ${cResult.checked} checked`);
        _logEnd(contLog, 'success', `${cResult.found} new, ${cResult.checked} checked`);
        if (cResult.found > 0) _push('worker:contradictions-updated', {});
      } catch (err) {
        console.error('[worker] Contradiction scan error:', err.message);
        _logEnd(contLog, 'error', err.message);
      }
    }
  }

  _push('worker:status', await _buildStatus(true));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

/**
 * Start the background worker.
 * Safe to call multiple times — will not start a second loop.
 */
function startWorker() {
  if (_running) return;
  _running = true;

  // Initialise interval settings from persisted settings
  const saved = getSettings().workerIntervals || {};
  _intervals.embedding     = saved.embedding     || 60;
  _intervals.clustering    = saved.clustering    || 300;
  _intervals.contradiction = saved.contradiction || 900;
  _ticksUntilCluster       = Math.round(_intervals.clustering    / _intervals.embedding);
  _ticksUntilContradiction = Math.round(_intervals.contradiction / _intervals.embedding);

  console.log(`[worker] Started (embed:${_intervals.embedding}s cluster:${_intervals.clustering}s contradiction:${_intervals.contradiction}s batch:${BATCH_SIZE})`);

  // Run once immediately, then on interval
  processBatch().catch((e) => console.error('[worker] Unexpected error:', e.message));

  _timer = setInterval(() => {
    processBatch().catch((e) => console.error('[worker] Unexpected error:', e.message));
  }, _intervals.embedding * 1000);

  // Allow Node/Electron to exit even if the timer is still armed
  if (_timer.unref) _timer.unref();
}

/**
 * Stop the background worker.
 */
function stopWorker() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  console.log('[worker] Stopped');
}

/**
 * Pause/resume processing (Ollama or UI preference).
 */
function pauseWorker() { _paused = true;  console.log('[worker] Paused');  }
function resumeWorker() { _paused = false; console.log('[worker] Resumed'); }

/**
 * Returns current worker state — useful for a status UI.
 */
function workerStatus() {
  return {
    running: _running,
    paused: _paused,
    queueLength: _queueLength,
    classifyQueueLength: _classifyQueueLength,
    lastProcessed: _lastProcessed,
    currentTask: _currentTask ? { task: _currentTask.task, startedAt: _currentTask.startedAt } : null,
    lastError: _taskLog.slice().reverse().find((e) => e.status === 'error') || null,
  };
}

/**
 * Return a snapshot of the task activity log (newest last).
 * @returns {object[]}
 */
function getWorkerLog() {
  return _taskLog.slice();
}

/**
 * Clear the in-memory task activity log and reset lastError state.
 * Primarily used in tests to reset module-level state between cases.
 */
function clearWorkerLog() {
  _taskLog.length = 0;
  _currentTask = null;
}

/**
 * Build the full status payload (worker + ollama) for pushing to renderer.
 * @param {boolean} ollamaReachable - whether the current tick found Ollama up
 */
async function _buildStatus(ollamaReachable) {
  const ollama = ollamaReachable ? await getOllamaStatus() : { running: false, availableModels: [], loadedModels: [] };
  return { worker: workerStatus(), ollama };
}

/**
 * Register the renderer's webContents so the worker can push IPC events.
 * Call this once from main.js after the library window is created.
 * @param {Electron.WebContents} webContents
 */
function setMainWindow(webContents) {
  _webContents = webContents;
}

/**
 * Clear embeddings for ALL entries so the worker re-processes everything.
 * Returns the number of entries queued for reindex.
 */
async function reindexAll() {
  await clearAllEmbeddings();
  await clearAllVectors();
  _embeddedSinceCluster = 0;
  // Kick off an immediate batch so the status bar updates right away
  processBatch().catch((e) => console.error('[worker] reindexAll batch error:', e.message));
  const queued = (await listEntriesWithoutEmbedding()).length;
  return { queued };
}

/**
 * Clear the embedding for a single entry so the worker re-processes it.
 * @param {string} entryId
 */
async function reindexEntry(entryId) {
  await deleteEmbedding(entryId);
  await deleteVector(entryId);
  processBatch().catch((e) => console.error('[worker] reindexEntry batch error:', e.message));
  return { ok: true };
}

/**
 * Scan themes for contradicting entry pairs.
 * Only checks pairs involving entries created after the last scan,
 * skipping pairs already in the contradictions table.
 * Caps at CONTRADICTION_MAX_PAIRS per run to avoid LLM overload.
 * @returns {Promise<{ checked: number, found: number }>}
 */
async function scanContradictions() {
  const { openDb } = require('../backend/db/connection');
  const db = await openDb();

  // Fetch all themes and their entries (id + content + created_at)
  const themes = db.prepare('SELECT id FROM themes').all();
  if (themes.length === 0) return { checked: 0, found: 0 };

  let checked = 0;
  let found = 0;
  const scanStart = new Date().toISOString();

  for (const { id: themeId } of themes) {
    if (checked >= CONTRADICTION_MAX_PAIRS) break;

    const entries = db.prepare(`
      SELECT e.id, e.content, e.created_at
      FROM entries e
      INNER JOIN theme_entries te ON te.entry_id = e.id
      WHERE te.theme_id = ?
      ORDER BY e.created_at DESC
    `).all(themeId);

    if (entries.length < 2) continue;

    // Identify entries that are new since the last scan (or all if first scan)
    const newEntries = _lastContradictionScan
      ? entries.filter((e) => e.created_at > _lastContradictionScan)
      : entries.slice(0, Math.min(5, entries.length)); // cold start: check up to 5 newest

    for (const newEntry of newEntries) {
      if (checked >= CONTRADICTION_MAX_PAIRS) break;

      for (const otherEntry of entries) {
        if (checked >= CONTRADICTION_MAX_PAIRS) break;
        if (otherEntry.id === newEntry.id) continue;

        const alreadyKnown = await pairExists(newEntry.id, otherEntry.id);
        if (alreadyKnown) continue;

        checked++;
        try {
          const contradicts = await detectContradiction(newEntry.content, otherEntry.content);
          if (contradicts) {
            await createContradiction({
              entry_a_id: newEntry.id,
              entry_b_id: otherEntry.id,
              theme_id: themeId,
            });
            found++;
            console.log(`[worker] Contradiction found: ${newEntry.id.slice(0, 8)}… ↔ ${otherEntry.id.slice(0, 8)}…`);
          }
        } catch (err) {
          console.warn(`[worker] detectContradiction failed: ${err.message}`);
        }
      }
    }
  }

  _lastContradictionScan = scanStart;
  return { checked, found };
}

module.exports = { startWorker, stopWorker, pauseWorker, resumeWorker, workerStatus, getWorkerLog, clearWorkerLog, setWorkerIntervals, setMainWindow, getOllamaStatus, reindexAll, reindexEntry, scanContradictions };
