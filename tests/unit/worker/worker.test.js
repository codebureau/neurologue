'use strict';

/**
 * Tests for src/worker/index.js.
 *
 * All external dependencies are mocked — no DB, no Ollama, no LanceDB.
 * Module-level state (_running, _paused) is reset by calling stopWorker()
 * and resumeWorker() in afterEach.
 */

// Mock all external dependencies before any require
jest.mock('../../../src/backend/db/embeddings');
jest.mock('../../../src/backend/db/entries');
jest.mock('../../../src/backend/vector/store');
jest.mock('../../../src/worker/ollama');

const mockEmbeddings = require('../../../src/backend/db/embeddings');
const mockEntries   = require('../../../src/backend/db/entries');
const mockStore     = require('../../../src/backend/vector/store');
const mockOllama    = require('../../../src/worker/ollama');

// Flush all pending promises + microtasks (multiple rounds for chained awaits)
async function flushAsync() {
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function makeVector(size = 384) {
  return new Float32Array(size).fill(0.5);
}

beforeEach(() => {
  jest.clearAllMocks();

  // Safe defaults — Ollama up, no pending entries
  mockOllama.isOllamaAvailable.mockResolvedValue(true);
  mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue([]);
  mockEmbeddings.upsertEmbedding.mockResolvedValue(undefined);
  mockEntries.getEntryById.mockResolvedValue(undefined);
  mockEntries.updateEntryCategory.mockResolvedValue(undefined);
  mockEntries.listEntriesWithoutCategory.mockResolvedValue([]);
  mockStore.upsertVector.mockResolvedValue(undefined);
  mockOllama.generateEmbedding.mockResolvedValue(makeVector());
  mockOllama.classifyEntry.mockResolvedValue('Thought');
});

afterEach(() => {
  const { stopWorker, resumeWorker, clearWorkerLog } = require('../../../src/worker/index');
  stopWorker();
  resumeWorker(); // reset _paused in case a test set it
  clearWorkerLog(); // reset task log and currentTask/_lastError
});

// ---------------------------------------------------------------------------
// processBatch behaviour (tested via startWorker's immediate call)
// ---------------------------------------------------------------------------

describe('processBatch', () => {
  test('skips processing when Ollama is unavailable', async () => {
    mockOllama.isOllamaAvailable.mockResolvedValue(false);
    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();
    expect(mockEmbeddings.listEntriesWithoutEmbedding).not.toHaveBeenCalled();
  });

  test('does nothing when there are no pending entries', async () => {
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue([]);
    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();
    expect(mockOllama.generateEmbedding).not.toHaveBeenCalled();
  });

  test('embeds each pending entry and stores in SQLite and LanceDB', async () => {
    const ids = ['id-aaa', 'id-bbb'];
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(ids);
    mockEntries.getEntryById
      .mockResolvedValueOnce({ id: 'id-aaa', content: 'first thought' })
      .mockResolvedValueOnce({ id: 'id-bbb', content: 'second thought' });
    const vec = makeVector();
    mockOllama.generateEmbedding.mockResolvedValue(vec);

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    expect(mockOllama.generateEmbedding).toHaveBeenCalledTimes(2);
    expect(mockOllama.generateEmbedding).toHaveBeenCalledWith('first thought');
    expect(mockOllama.generateEmbedding).toHaveBeenCalledWith('second thought');

    expect(mockEmbeddings.upsertEmbedding).toHaveBeenCalledTimes(2);
    expect(mockStore.upsertVector).toHaveBeenCalledTimes(2);
  });

  test('respects BATCH_SIZE — processes at most 5 entries per tick', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; // 7 pending
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(ids);
    mockEntries.getEntryById.mockResolvedValue({ id: 'x', content: 'content' });

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    // Only first 5 should be processed
    expect(mockOllama.generateEmbedding).toHaveBeenCalledTimes(5);
  });

  test('skips entries that are not found in the DB', async () => {
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(['ghost-id']);
    mockEntries.getEntryById.mockResolvedValue(undefined); // not found

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    expect(mockOllama.generateEmbedding).not.toHaveBeenCalled();
  });

  test('catches a per-entry error and continues processing remaining entries', async () => {
    const ids = ['fail-id', 'ok-id'];
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(ids);
    mockEntries.getEntryById
      .mockResolvedValueOnce({ id: 'fail-id', content: 'bad entry' })
      .mockResolvedValueOnce({ id: 'ok-id',   content: 'good entry' });
    mockOllama.generateEmbedding
      .mockRejectedValueOnce(new Error('embedding failed'))
      .mockResolvedValueOnce(makeVector());

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    // Second entry should still be processed despite first failing
    expect(mockEmbeddings.upsertEmbedding).toHaveBeenCalledTimes(1);
    expect(mockStore.upsertVector).toHaveBeenCalledTimes(1);
  });

  test('skips processing when worker is paused', async () => {
    const { startWorker, pauseWorker } = require('../../../src/worker/index');
    pauseWorker();
    startWorker();
    await flushAsync();

    expect(mockOllama.isOllamaAvailable).not.toHaveBeenCalled();
  });

  test('classification backfill: classifies entries that have no category', async () => {
    // No entries need embedding, but one needs classification
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue([]);
    mockEntries.listEntriesWithoutCategory.mockResolvedValue(['existing-id']);
    mockEntries.getEntryById.mockResolvedValue({ id: 'existing-id', content: 'old note', category: null });
    mockOllama.classifyEntry.mockResolvedValue('Idea');

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    expect(mockOllama.classifyEntry).toHaveBeenCalledWith('old note');
    expect(mockEntries.updateEntryCategory).toHaveBeenCalledWith('existing-id', 'Idea', 'llm');
  });

  test('classification backfill: handles a classification error without stopping', async () => {
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue([]);
    mockEntries.listEntriesWithoutCategory.mockResolvedValue(['bad-id', 'good-id']);
    mockEntries.getEntryById
      .mockResolvedValueOnce({ id: 'bad-id',  content: 'bad',  category: null })
      .mockResolvedValueOnce({ id: 'good-id', content: 'good', category: null });
    mockOllama.classifyEntry
      .mockRejectedValueOnce(new Error('LLM offline'))
      .mockResolvedValueOnce('Task');

    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    expect(mockEntries.updateEntryCategory).toHaveBeenCalledTimes(1);
    expect(mockEntries.updateEntryCategory).toHaveBeenCalledWith('good-id', 'Task', 'llm');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: startWorker / stopWorker
// ---------------------------------------------------------------------------

describe('startWorker / stopWorker', () => {
  test('startWorker sets running to true', () => {
    const { startWorker, workerStatus } = require('../../../src/worker/index');
    startWorker();
    expect(workerStatus().running).toBe(true);
  });

  test('startWorker is a no-op if already running', async () => {
    const { startWorker } = require('../../../src/worker/index');
    startWorker();
    startWorker(); // second call
    await flushAsync();
    // processBatch should only have been triggered once (the initial immediate call)
    expect(mockOllama.isOllamaAvailable).toHaveBeenCalledTimes(1);
  });

  test('stopWorker sets running to false', () => {
    const { startWorker, stopWorker, workerStatus } = require('../../../src/worker/index');
    startWorker();
    stopWorker();
    expect(workerStatus().running).toBe(false);
  });

  test('stopWorker can be called when not running without error', () => {
    const { stopWorker } = require('../../../src/worker/index');
    expect(() => stopWorker()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// pauseWorker / resumeWorker
// ---------------------------------------------------------------------------

describe('pauseWorker / resumeWorker', () => {
  test('pauseWorker sets paused to true', () => {
    const { pauseWorker, workerStatus } = require('../../../src/worker/index');
    pauseWorker();
    expect(workerStatus().paused).toBe(true);
  });

  test('resumeWorker sets paused to false', () => {
    const { pauseWorker, resumeWorker, workerStatus } = require('../../../src/worker/index');
    pauseWorker();
    resumeWorker();
    expect(workerStatus().paused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// workerStatus
// ---------------------------------------------------------------------------

describe('workerStatus', () => {
  test('returns running: false and paused: false initially', () => {
    const { workerStatus } = require('../../../src/worker/index');
    const status = workerStatus();
    expect(status.running).toBe(false);
    expect(status.paused).toBe(false);
  });

  test('returns currentTask: null and lastError: null initially', () => {
    const { workerStatus } = require('../../../src/worker/index');
    const { currentTask, lastError } = workerStatus();
    expect(currentTask).toBeNull();
    expect(lastError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWorkerLog
// ---------------------------------------------------------------------------

describe('getWorkerLog', () => {
  test('returns an empty array initially', () => {
    const { getWorkerLog } = require('../../../src/worker/index');
    expect(getWorkerLog()).toEqual([]);
  });

  test('returns a copy — mutating the result does not affect the log', () => {
    const { getWorkerLog } = require('../../../src/worker/index');
    const log = getWorkerLog();
    log.push({ fake: true });
    expect(getWorkerLog()).toHaveLength(0);
  });

  test('records a completed entry after a successful embedding batch', async () => {
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(['id-1']);
    mockEntries.getEntryById.mockResolvedValue({ id: 'id-1', content: 'hello' });

    const { startWorker, getWorkerLog } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    const log = getWorkerLog();
    const embeddingEntry = log.find((e) => e.task === 'embedding');
    expect(embeddingEntry).toBeDefined();
    expect(embeddingEntry.status).toBe('success');
    expect(embeddingEntry.completedAt).toBeDefined();
    expect(embeddingEntry.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records an error entry when all entries in a batch fail to embed', async () => {
    mockEmbeddings.listEntriesWithoutEmbedding.mockResolvedValue(['fail-id']);
    mockEntries.getEntryById.mockResolvedValue({ id: 'fail-id', content: 'bad content' });
    mockOllama.generateEmbedding.mockRejectedValue(new Error('Ollama unavailable'));

    const { startWorker, getWorkerLog } = require('../../../src/worker/index');
    startWorker();
    await flushAsync();

    const log = getWorkerLog();
    const errEntry = log.find((e) => e.task === 'embedding' && e.status === 'error');
    expect(errEntry).toBeDefined();
    expect(errEntry.message).toMatch(/failed/);
  });
});

// ---------------------------------------------------------------------------
// setWorkerIntervals
// ---------------------------------------------------------------------------

describe('setWorkerIntervals', () => {
  test('accepts partial updates without throwing', () => {
    const { setWorkerIntervals } = require('../../../src/worker/index');
    expect(() => setWorkerIntervals({ clustering: 120 })).not.toThrow();
  });

  test('accepts a full update without throwing', () => {
    const { setWorkerIntervals } = require('../../../src/worker/index');
    expect(() => setWorkerIntervals({ embedding: 30, clustering: 120, contradiction: 600 })).not.toThrow();
  });

  test('is a no-op when called with an empty object', () => {
    const { setWorkerIntervals } = require('../../../src/worker/index');
    expect(() => setWorkerIntervals({})).not.toThrow();
  });
});
