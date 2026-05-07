'use strict';

/**
 * Minimal Ollama HTTP client.
 *
 * Uses Node's built-in `http` module — no extra dependencies.
 * All requests go to the base URL defined in src/config.js.
 */

const http   = require('http');
const { exec } = require('child_process');
const config = require('../config');
const { getSettings } = require('../backend/settings');

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

const VALID_CATEGORIES = ['Task', 'Thought', 'Reminder', 'Idea', 'Question', 'Decision'];

/**
 * Classify a piece of text into one of the six entry categories using an LLM.
 * Uses the chat-generation model (phi3:mini or user-configured chat model).
 *
 * @param {string} text  The entry content to classify
 * @returns {Promise<string>}  One of: Task, Thought, Reminder, Idea, Question, Decision
 */
async function classifyEntry(text) {
  const settings = getSettings();
  const model = settings.chatModel || settings.embeddingModel || 'phi3:mini';

  const prompt =
    'Classify the following note into exactly one of these categories:\n' +
    'Task, Thought, Reminder, Idea, Question, Decision\n\n' +
    'Reply with only the category name and nothing else.\n\n' +
    `Note: ${text.slice(0, 500)}`;

  const response = await ollamaRequest('/api/generate', {
    model,
    prompt,
    stream: false,
    options: { temperature: 0, num_predict: 10 },
  });

  const raw = (response.response || '').trim();
  // Find which valid category appears in the response (case-insensitive)
  const match = VALID_CATEGORIES.find((c) => raw.toLowerCase().startsWith(c.toLowerCase()));
  return match || 'Thought'; // safe fallback
}


module.exports = { generateEmbedding, isOllamaAvailable, getOllamaStatus, checkOllamaInstalled, pullModel, classifyEntry };
