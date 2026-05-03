'use strict';

/**
 * Minimal Ollama HTTP client.
 *
 * Uses Node's built-in `http` module — no extra dependencies.
 * All requests go to the base URL defined in src/config.js.
 */

const http = require('http');
const config = require('../config');

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
  const response = await ollamaRequest('/api/embeddings', {
    model: config.ollama.embeddingModel,
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

module.exports = { generateEmbedding, isOllamaAvailable };
