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

const { listEntriesWithoutEmbedding, upsertEmbedding } = require('../backend/db/embeddings');
const { getEntryById } = require('../backend/db/entries');
const { upsertVector } = require('../backend/vector/store');
const { generateEmbedding, isOllamaAvailable } = require('./ollama');
const config = require('../config');

const POLL_INTERVAL_MS = 10_000; // check every 10 seconds
const BATCH_SIZE = 5;            // process up to 5 entries per tick

let _timer = null;
let _running = false;
let _paused = false;

// ── Core processing ───────────────────────────────────────────────────────

async function processBatch() {
  if (_paused) return;

  const available = await isOllamaAvailable();
  if (!available) {
    console.log('[worker] Ollama not available — skipping tick');
    return;
  }

  const entryIds = await listEntriesWithoutEmbedding();
  if (entryIds.length === 0) return;

  const batch = entryIds.slice(0, BATCH_SIZE);
  console.log(`[worker] Processing ${batch.length} of ${entryIds.length} pending entries`);

  for (const id of batch) {
    try {
      const entry = await getEntryById(id);
      if (!entry) continue;

      const vector = await generateEmbedding(entry.content);
      const modelName = config.ollama.embeddingModel;

      // Store in SQLite (compact BLOB backup)
      await upsertEmbedding(id, vector, modelName);

      // Store in LanceDB (primary vector index for similarity search)
      await upsertVector(id, vector, modelName);

      console.log(`[worker] Embedded entry ${id.slice(0, 8)}…`);
    } catch (err) {
      // Log and continue — a single failure must not stop the batch
      console.error(`[worker] Failed to embed entry ${id.slice(0, 8)}…: ${err.message}`);
    }
  }
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
  return { running: _running, paused: _paused };
}

module.exports = { startWorker, stopWorker, pauseWorker, resumeWorker, workerStatus };
