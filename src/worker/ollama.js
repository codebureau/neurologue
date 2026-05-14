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
/**
 * Send a JSON request to the Ollama API.
 * @param {string} path  e.g. '/api/embeddings'
 * @param {object} body  JSON-serialisable request body
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<object>}
 */
function ollamaRequest(path, body, timeoutMs = 30000) {
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

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Ollama request timed out after ${timeoutMs / 1000}s`));
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

  // Keep the classification model-availability cache up to date
  setAvailableModels(availableModels);

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

// Cached set of available model names (refreshed via getOllamaStatus calls)
let _availableModels = null;

/**
 * Classify a piece of text into one of the six entry categories using an LLM.
 * Uses the LLM model (llmModel setting, default phi3:mini).
 * Skips silently if the model is not installed.
 * Uses a 120s timeout to allow for cold model loading.
 *
 * @param {string} text  The entry content to classify
 * @returns {Promise<string>}  One of: Task, Thought, Reminder, Idea, Question, Decision
 */
async function classifyEntry(text) {
  const settings = getSettings();
  // Use the LLM model, never the embedding model (embedding models don't support /api/generate)
  const model = settings.llmModel || 'phi3:mini';

  // Check the model is actually installed — avoid spinning indefinitely against a missing model.
  // _availableModels is populated by getOllamaStatus() which the worker calls regularly.
  if (_availableModels !== null && !_availableModels.some((m) => m === model || m.startsWith(model + ':'))) {
    throw new Error(`LLM model '${model}' is not installed — skipping classification`);
  }

  const prompt =
    'Classify the following note into exactly one of these categories:\n' +
    'Task, Thought, Reminder, Idea, Question, Decision\n\n' +
    'Reply with only the category name and nothing else.\n\n' +
    `Note: ${text.slice(0, 500)}`;

  // 120s timeout: allows for cold model loading from disk
  const response = await ollamaRequest('/api/generate', {
    model,
    prompt,
    stream: false,
    options: { temperature: 0, num_predict: 10 },
  }, 120_000);

  const raw = (response.response || '').trim();
  const match = VALID_CATEGORIES.find((c) => raw.toLowerCase().startsWith(c.toLowerCase()));
  return match || 'Thought'; // safe fallback
}

/**
 * Suggest up to 5 relevant tags for a piece of text using an LLM.
 * Receives the existing tag corpus so it can reuse known tags where appropriate,
 * but may also suggest new ones.
 *
 * @param {string}   text         The entry content to tag
 * @param {string[]} [knownTags]  Existing tags in the library (for reuse hints)
 * @returns {Promise<string[]>}   Up to 5 lowercase tag names
 */
async function suggestTags(text, knownTags = []) {
  const settings = getSettings();
  const model = settings.llmModel || 'phi3:mini';
  const useHyphens = (settings.tagSuggestionFormat || 'hyphenated') === 'hyphenated';

  if (_availableModels !== null && !_availableModels.some((m) => m === model || m.startsWith(model + ':'))) {
    throw new Error(`LLM model '${model}' is not installed — skipping tag suggestions`);
  }

  const knownHint = knownTags.length > 0
    ? `Existing tags you may reuse if relevant: ${knownTags.slice(0, 30).join(', ')}.\n`
    : '';

  const prompt =
    'Suggest up to 5 short, lowercase tags for the following note.\n' +
    knownHint +
    'Reply with only a comma-separated list of tags and nothing else. ' +
    'Tags should be single words or short hyphenated phrases.\n\n' +
    `Note: ${text.slice(0, 500)}`;

  const response = await ollamaRequest('/api/generate', {
    model,
    prompt,
    stream: false,
    options: { temperature: 0.2, num_predict: 40 },
  }, 120_000);

  const raw = (response.response || '').trim();
  return raw
    .split(',')
    .map((t) => {
      const clean = t.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
      return useHyphens
        ? clean.replace(/\s+/g, '-')   // two words → two-words
        : clean.replace(/[\s-]+/g, ''); // two words / two-words → twowords
    })
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * Update the cached list of available models (called from getOllamaStatus).
 * @param {string[]} models
 */
function setAvailableModels(models) {
  _availableModels = models;
}


/**
 * Determine whether two statements directly contradict each other.
 * Returns true if the LLM judges them contradictory, false otherwise.
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {Promise<boolean>}
 */
async function detectContradiction(textA, textB) {
  const settings = getSettings();
  const model = settings.llmModel || 'phi3:mini';

  if (_availableModels !== null && !_availableModels.some((m) => m === model || m.startsWith(model + ':'))) {
    throw new Error(`LLM model '${model}' is not installed — skipping contradiction check`);
  }

  const prompt =
    'You are a careful analyst. Determine whether the two statements below directly ' +
    'contradict each other. A contradiction means they cannot both be true at the same time.\n\n' +
    `Statement A: "${textA.slice(0, 400)}"\n` +
    `Statement B: "${textB.slice(0, 400)}"\n\n` +
    'Reply with exactly one word: YES or NO.';

  const response = await ollamaRequest('/api/generate', {
    model,
    prompt,
    stream: false,
    options: { temperature: 0, num_predict: 5 },
  }, 120_000);

  const raw = (response.response || '').trim().toUpperCase();
  return raw.startsWith('YES');
}

/**
 * Compute entry signals (EVOM components) for a piece of text using an LLM.
 * Returns a parsed object; falls back to neutral defaults on parse failure.
 *
 * @param {string} text
 * @returns {Promise<{
 *   sentiment_score: number,
 *   emotional_intensity: number,
 *   obligation_flag: boolean,
 *   motivation_flag: boolean,
 *   value_reference_flag: boolean,
 *   open_loop_flag: boolean,
 * }>}
 */
async function computeEntrySignals(text) {
  const settings = getSettings();
  const model = settings.llmModel || 'phi3:mini';

  if (_availableModels !== null && !_availableModels.some((m) => m === model || m.startsWith(model + ':'))) {
    throw new Error(`LLM model '${model}' is not installed — skipping signal computation`);
  }

  const prompt =
    'Analyse the following note and respond with a JSON object only — no explanation.\n\n' +
    'Fields:\n' +
    '  sentiment_score: number from -1 (very negative) to 1 (very positive)\n' +
    '  emotional_intensity: number from 0 (neutral) to 1 (highly emotional)\n' +
    '  obligation_flag: true if the note contains a commitment, deadline, or duty\n' +
    '  motivation_flag: true if the note expresses desire, enthusiasm, or personal drive\n' +
    '  value_reference_flag: true if the note references personal values or long-term goals\n' +
    '  open_loop_flag: true if the note suggests an unresolved question or incomplete action\n\n' +
    `Note: ${text.slice(0, 600)}\n\n` +
    'Respond with only valid JSON.';

  const response = await ollamaRequest('/api/generate', {
    model,
    prompt,
    stream: false,
    options: { temperature: 0, num_predict: 120 },
  }, 120_000);

  const raw = (response.response || '').trim();
  // Extract JSON object from response (model may wrap it in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return _neutralSignals();

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      sentiment_score:      clamp(Number(parsed.sentiment_score)     ?? 0, -1, 1),
      emotional_intensity:  clamp(Number(parsed.emotional_intensity) ?? 0,  0, 1),
      obligation_flag:      Boolean(parsed.obligation_flag),
      motivation_flag:      Boolean(parsed.motivation_flag),
      value_reference_flag: Boolean(parsed.value_reference_flag),
      open_loop_flag:       Boolean(parsed.open_loop_flag),
    };
  } catch {
    return _neutralSignals();
  }
}

function _neutralSignals() {
  return {
    sentiment_score: 0, emotional_intensity: 0,
    obligation_flag: false, motivation_flag: false,
    value_reference_flag: false, open_loop_flag: false,
  };
}

function clamp(val, min, max) {
  if (!Number.isFinite(val)) return (min + max) / 2;
  return Math.min(max, Math.max(min, val));
}

module.exports = { generateEmbedding, isOllamaAvailable, getOllamaStatus, checkOllamaInstalled, pullModel, classifyEntry, suggestTags, setAvailableModels, detectContradiction, computeEntrySignals };
