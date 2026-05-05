'use strict';

/**
 * Minimal Ollama HTTP client.
 *
 * Uses Node's built-in `http` module — no extra dependencies.
 * All requests go to the base URL defined in src/config.js.
 */

const http   = require('http');
const { exec, spawn } = require('child_process');
const config = require('../config');
const { getSettings } = require('../backend/settings');

/** Tracks the Ollama process we started (null if not started by us). */
let _ollamaProcess = null;

/**
 * Send a JSON request to the Ollama API.
 * @param {string} path  e.g. '/api/embeddings'
 * @param {object} body  JSON-serialisable request body
 * @returns {Promise<object>}
 */
function ollamaRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(config.ollama.baseUrl);

    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(text);
          if (res.statusCode >= 400) {
            reject(new Error(`Ollama ${res.statusCode}: ${json.error || text}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`Ollama response parse error: ${e.message}`));
        }
      });
    });

    req.setTimeout(30000, () => {
      req.destroy(new Error('Ollama request timed out after 30s'));
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Generate an embedding vector for a piece of text.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function generateEmbedding(text) {
  const model = getSettings().embeddingModel;
  const response = await ollamaRequest('/api/embeddings', {
    model,
    prompt: text,
  });

  if (!Array.isArray(response.embedding)) {
    throw new Error('Ollama returned no embedding array');
  }

  return new Float32Array(response.embedding);
}

/**
 * Check whether Ollama is reachable and the embedding model is available.
 * @returns {Promise<boolean>}
 */
function isOllamaAvailable() {
  return new Promise((resolve) => {
    const url = new URL(config.ollama.baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port || 11434, path: '/api/tags', method: 'GET' },
      (res) => {
        res.resume(); // drain
        resolve(res.statusCode < 500);
      }
    );
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * GET helper for Ollama (no request body).
 * @param {string} path
 * @param {number} timeoutMs
 * @returns {Promise<object|null>} parsed JSON or null on error/timeout
 */
function ollamaGet(path, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const url = new URL(config.ollama.baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port || 11434, path, method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

/**
 * Get detailed Ollama runtime status.
 * @returns {Promise<{running: boolean, availableModels: string[], loadedModels: Array<{name:string,sizeVram:number}>}>}
 */
async function getOllamaStatus() {
  const [tags, ps] = await Promise.all([
    ollamaGet('/api/tags'),
    ollamaGet('/api/ps'),
  ]);

  if (!tags) {
    return { running: false, availableModels: [], loadedModels: [] };
  }

  const availableModels = (tags.models || []).map((m) => m.name);
  const loadedModels = (ps && ps.models ? ps.models : []).map((m) => ({
    name: m.name,
    sizeVram: m.size_vram || 0,
  }));

  return { running: true, availableModels, loadedModels };
}

/**
 * Check whether the `ollama` CLI is installed on this machine.
 * @returns {Promise<{installed: boolean, version: string|null}>}
 */
function checkOllamaInstalled() {
  return new Promise((resolve) => {
    exec('ollama --version', { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ installed: false, version: null });
      } else {
        const match = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve({ installed: true, version: match ? match[1] : stdout.trim() });
      }
    });
  });
}

/**
 * Pull an Ollama model, streaming progress events to the caller.
 * @param {string} name  e.g. 'nomic-embed-text'
 * @param {function} [onProgress]  called with each NDJSON progress object
 * @returns {Promise<void>}
 */
function pullModel(name, onProgress) {
  return new Promise((resolve, reject) => {
    const url     = new URL(config.ollama.baseUrl);
    const payload = JSON.stringify({ name, stream: true });

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 11434,
        path: '/api/pull',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk.toString('utf8');
          // NDJSON: split on newlines, keep any incomplete tail
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (onProgress) onProgress(obj);
            } catch { /* ignore malformed line */ }
          }
        });
        res.on('end', () => {
          // Flush any remaining buffer
          if (buf.trim()) {
            try {
              const obj = JSON.parse(buf);
              if (onProgress) onProgress(obj);
            } catch { /* ignore */ }
          }
          resolve();
        });
      }
    );

    // 5-minute hard cap for large model downloads
    req.setTimeout(300_000, () => req.destroy(new Error('pullModel timed out after 5 min')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Start the Ollama server by spawning `ollama serve` in the background.
 * Resolves quickly; the caller should poll isOllamaAvailable() to confirm readiness.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function startOllama() {
  return new Promise((resolve) => {
    if (_ollamaProcess) {
      resolve({ ok: true });
      return;
    }
    try {
      const proc = spawn('ollama', ['serve'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        shell: true,  // required on Windows to resolve PATH
      });
      let resolved = false;
      _ollamaProcess = proc;
      proc.on('error', (err) => {
        _ollamaProcess = null;
        if (!resolved) { resolved = true; resolve({ ok: false, error: err.message }); }
      });
      proc.on('exit', (code) => {
        _ollamaProcess = null;
        if (!resolved) { resolved = true; resolve({ ok: false, error: `ollama exited with code ${code}` }); }
      });
      // Give the process one event-loop tick to fail fast; then assume it started ok
      setImmediate(() => {
        if (!resolved) { resolved = true; resolve({ ok: true }); }
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Stop the Ollama server.
 * If Neurologue started it, the tracked process is killed.
 * Otherwise an OS-level kill command is used.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
function stopOllama() {
  return new Promise((resolve) => {
    // Clear our reference so startOllama can be called again
    if (_ollamaProcess) {
      try { _ollamaProcess.kill(); } catch { /* ignore */ }
      _ollamaProcess = null;
    }
    // Always use an OS-level kill — when started via shell:true, proc.kill()
    // only kills the shell wrapper, not the ollama process itself.
    const cmd = process.platform === 'win32'
      ? 'taskkill /F /IM ollama.exe'
      : 'pkill -x ollama';
    exec(cmd, { timeout: 5000 }, (err) => {
      // exit code 1 from pkill means "no process found" — not a real error
      if (err && err.code !== 1 && !err.killed) {
        resolve({ ok: false, error: err.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

module.exports = { generateEmbedding, isOllamaAvailable, getOllamaStatus, checkOllamaInstalled, pullModel, startOllama, stopOllama };
