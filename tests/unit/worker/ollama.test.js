'use strict';

/**
 * Tests for src/worker/ollama.js.
 *
 * All HTTP calls are intercepted via jest.mock('http') — no real Ollama needed.
 */

jest.mock('http', () => ({ request: jest.fn() }));
const http = require('http');
const { generateEmbedding, isOllamaAvailable, getOllamaStatus } = require('../../../src/worker/ollama');

// ---------------------------------------------------------------------------
// Helpers to build fake HTTP request/response pairs
// ---------------------------------------------------------------------------

/**
 * Simulate a successful HTTP response.
 * `end()` on the returned req triggers the response callback synchronously,
 * fires data, then end — matching how Node streams work in tests.
 */
function mockHttpResponse(statusCode, body) {
  http.request.mockImplementation((_opts, callback) => {
    const resHandlers = {};
    const mockRes = {
      statusCode,
      resume: jest.fn(),
      on: jest.fn((event, handler) => { resHandlers[event] = handler; }),
    };
    return {
      setTimeout: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(() => {
        callback(mockRes);
        if (resHandlers.data) {
          resHandlers.data(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
        }
        if (resHandlers.end) resHandlers.end();
      }),
    };
  });
}

/** Simulate a connection-level error (ECONNREFUSED etc.) */
function mockHttpError(message) {
  http.request.mockImplementation(() => {
    const errHandlers = {};
    return {
      setTimeout: jest.fn(),
      on: jest.fn((event, handler) => { errHandlers[event] = handler; }),
      write: jest.fn(),
      end: jest.fn(() => {
        if (errHandlers.error) errHandlers.error(new Error(message));
      }),
    };
  });
}

/** Simulate req.setTimeout firing (timeout before response). */
function mockHttpTimeout() {
  http.request.mockImplementation(() => {
    let timeoutCb;
    const mockReq = {
      setTimeout: jest.fn((_ms, cb) => { timeoutCb = cb; }),
      on: jest.fn(),
      write: jest.fn(),
      destroy: jest.fn(),
      end: jest.fn(() => {
        // Fire the timeout immediately instead of after 30s
        if (timeoutCb) timeoutCb();
      }),
    };
    return mockReq;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// generateEmbedding
// ---------------------------------------------------------------------------

describe('generateEmbedding', () => {
  test('returns a Float32Array on success', async () => {
    mockHttpResponse(200, { embedding: [0.1, 0.2, 0.3] });
    const result = await generateEmbedding('test text');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1, 5);
    expect(result[2]).toBeCloseTo(0.3, 5);
  });

  test('throws when response contains no embedding array', async () => {
    mockHttpResponse(200, { message: 'ok but no embedding' });
    await expect(generateEmbedding('test')).rejects.toThrow('no embedding array');
  });

  test('throws on HTTP 4xx response', async () => {
    mockHttpResponse(400, { error: 'model not found' });
    await expect(generateEmbedding('test')).rejects.toThrow('400');
  });

  test('throws on HTTP 5xx response', async () => {
    mockHttpResponse(500, { error: 'internal server error' });
    await expect(generateEmbedding('test')).rejects.toThrow('500');
  });

  test('throws on connection error', async () => {
    mockHttpError('connect ECONNREFUSED');
    await expect(generateEmbedding('test')).rejects.toThrow('ECONNREFUSED');
  });

  test('throws on malformed JSON response', async () => {
    mockHttpResponse(200, 'not-json{{{');
    await expect(generateEmbedding('test')).rejects.toThrow(/parse error/i);
  });
});

// ---------------------------------------------------------------------------
// isOllamaAvailable
// ---------------------------------------------------------------------------

describe('isOllamaAvailable', () => {
  test('returns true when Ollama responds with 2xx', async () => {
    mockHttpResponse(200, { models: [] });
    const result = await isOllamaAvailable();
    expect(result).toBe(true);
  });

  test('returns true on non-5xx status (e.g. 404)', async () => {
    // /api/tags returning 404 still means the server is up
    mockHttpResponse(404, {});
    const result = await isOllamaAvailable();
    expect(result).toBe(true);
  });

  test('returns false on connection error', async () => {
    mockHttpError('connect ECONNREFUSED');
    const result = await isOllamaAvailable();
    expect(result).toBe(false);
  });

  test('returns false when request times out', async () => {
    mockHttpTimeout();
    const result = await isOllamaAvailable();
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOllamaStatus
// ---------------------------------------------------------------------------

/**
 * Build a mock for a single GET request that returns the given body.
 * Returns the mock implementation function (for use with mockImplementationOnce).
 */
function makeGetMock(statusCode, body) {
  return (_opts, callback) => {
    const resHandlers = {};
    const mockRes = {
      statusCode,
      on: jest.fn((event, handler) => { resHandlers[event] = handler; }),
    };
    return {
      setTimeout: jest.fn(),
      on: jest.fn(),
      end: jest.fn(() => {
        callback(mockRes);
        if (resHandlers.data) {
          resHandlers.data(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
        }
        if (resHandlers.end) resHandlers.end();
      }),
    };
  };
}

/** Build a connection-error mock for a GET (no callback). */
function makeGetErrorMock(message) {
  return () => {
    const errHandlers = {};
    return {
      setTimeout: jest.fn(),
      on: jest.fn((event, handler) => { errHandlers[event] = handler; }),
      end: jest.fn(() => {
        if (errHandlers.error) errHandlers.error(new Error(message));
      }),
    };
  };
}

describe('getOllamaStatus', () => {
  test('returns running=true with model lists when Ollama responds', async () => {
    const tagBody = { models: [{ name: 'nomic-embed-text:latest' }, { name: 'phi3:mini' }] };
    const psBody  = { models: [{ name: 'phi3:mini', size_vram: 1234567 }] };
    http.request
      .mockImplementationOnce(makeGetMock(200, tagBody))
      .mockImplementationOnce(makeGetMock(200, psBody));

    const result = await getOllamaStatus();

    expect(result.running).toBe(true);
    expect(result.availableModels).toEqual(['nomic-embed-text:latest', 'phi3:mini']);
    expect(result.loadedModels).toEqual([{ name: 'phi3:mini', sizeVram: 1234567 }]);
  });

  test('returns running=true with empty loadedModels when /api/ps returns empty list', async () => {
    const tagBody = { models: [{ name: 'nomic-embed-text:latest' }] };
    const psBody  = { models: [] };
    http.request
      .mockImplementationOnce(makeGetMock(200, tagBody))
      .mockImplementationOnce(makeGetMock(200, psBody));

    const result = await getOllamaStatus();

    expect(result.running).toBe(true);
    expect(result.availableModels).toEqual(['nomic-embed-text:latest']);
    expect(result.loadedModels).toEqual([]);
  });

  test('returns running=false when Ollama is not reachable', async () => {
    http.request
      .mockImplementationOnce(makeGetErrorMock('connect ECONNREFUSED'))
      .mockImplementationOnce(makeGetErrorMock('connect ECONNREFUSED'));

    const result = await getOllamaStatus();

    expect(result.running).toBe(false);
    expect(result.availableModels).toEqual([]);
    expect(result.loadedModels).toEqual([]);
  });
});
