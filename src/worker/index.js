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
const { generateEmbedding, isOllamaAvailable, getOllamaStatus, classifyEntry } = require('./ollama');
const { runClustering } = require('../backend/clustering/themes');
const { getSettings } = require('../backend/settings');
const config = require('../config');

const POLL_INTERVAL_MS = 10_000; // check every 10 seconds
const BATCH_SIZE = 5;            // process up to 5 entries per tick
const CLASSIFY_BATCH_SIZE = 3;   // classify up to 3 already-embedded entries per tick
// Re-cluster after this many new embeddings are added in one session
const CLUSTER_AFTER = 5;

let _timer = null;
let _running = false;
let _paused = false;
let _embeddedSinceCluster = 0;
let _queueLength = 0;          // entries pending embedding
let _classifyQueueLength = 0;  // entries pending classification
let _lastProcessed = null; // ISO timestamp of last successfully embedded entry
let _webContents = null;  // set by setMainWindow() once the library window opens

// Push a channel + payload to the renderer (silently no-ops if window not ready)
function _push(channel, payload) {
  if (_webContents && !_webContents.isDestroyed()) {
    _webContents.send(channel, payload);
  }
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
  if (batch.length > 0) {
    console.log(`[worker] Embedding ${batch.length} of ${entryIds.length} pending entries`);
  }

  let newEmbeddings = 0;
  for (const id of batch) {
    try {
      const entry = await getEntryById(id);
      if (!entry) continue;

      const vector    = await generateEmbedding(entry.content);
      const modelName = getSettings().embeddingModel;

      // Store in SQLite (compact BLOB backup)
      await upsertEmbedding(id, vector, modelName);

      // Store in LanceDB (primary vector index for similarity search)
      await upsertVector(id, vector, modelName);

      // Classify entry if not already categorised — fire-and-forget, must not block embedding
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
      // Log and continue — a single failure must not stop the batch
      console.error(`[worker] Failed to embed entry ${id.slice(0, 8)}…: ${err.message}`);
    }
  }

  if (newEmbeddings > 0) {
    _push('worker:entries-updated', {});
  }

  // ── Pass 2: classify entries that are embedded but have no category ───
  // Handles existing content from before the classification feature shipped,
  // and any entry whose fire-and-forget classification failed.
  const unclassifiedIds = await listEntriesWithoutCategory(CLASSIFY_BATCH_SIZE);
  _classifyQueueLength = unclassifiedIds.length;
  _push('worker:status', await _buildStatus(true));
  let newCategories = 0;
  for (const id of unclassifiedIds) {
    try {
      const entry = await getEntryById(id);
      if (!entry) continue;
      const category = await classifyEntry(entry.content);
      await updateEntryCategory(id, category, 'llm');
      console.log(`[worker] Classified entry ${id.slice(0, 8)}… → ${category}`);
      newCategories++;
    } catch (err) {
      console.warn(`[worker] Classification failed for ${id.slice(0, 8)}…: ${err.message}`);
    }
  }
  _classifyQueueLength = 0;

  if (newCategories > 0) {
    _push('worker:entries-updated', {});
  }

  // Trigger clustering after enough new embeddings
  if (_embeddedSinceCluster >= CLUSTER_AFTER) {
    _embeddedSinceCluster = 0;
    try {
      const result = await runClustering();
      if (result.skipped) {
        console.log(`[worker] Clustering skipped: ${result.reason}`);
      } else {
        console.log(`[worker] Clustering complete — ${result.themes} themes`);
        _push('worker:themes-updated', {});
      }
    } catch (err) {
      console.error('[worker] Clustering error:', err.message);
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
  console.log(`[worker] Started (poll interval: ${POLL_INTERVAL_MS / 1000}s, batch: ${BATCH_SIZE})`);

  // Run once immediately, then on interval
  processBatch().catch((e) => console.error('[worker] Unexpected error:', e.message));

  _timer = setInterval(() => {
    processBatch().catch((e) => console.error('[worker] Unexpected error:', e.message));
  }, POLL_INTERVAL_MS);

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
  };
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

module.exports = { startWorker, stopWorker, pauseWorker, resumeWorker, workerStatus, setMainWindow, getOllamaStatus, reindexAll, reindexEntry };
