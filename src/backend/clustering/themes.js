'use strict';

/**
 * Theme clustering orchestrator.
 *
 * Pipeline:
 *   1. Fetch all stored embeddings from SQLite
 *   2. Run k-means (k chosen heuristically: sqrt(n/2), min 2, max 20)
 *   3. For each cluster: upsert a theme, assign entries with cosine-similarity scores
 *   4. Generate a short LLM summary for each theme (if Ollama is available)
 */

const { kmeans, cosineSimilarity } = require('./kmeans');
const { openDb } = require('../db/connection');
const { upsertTheme, setThemeEntries, listThemes } = require('../db/themes');
const { isOllamaAvailable } = require('../../worker/ollama');
const config = require('../../config');
const http = require('http');

// ── Minimum entries required before clustering is worthwhile ─────────────────
const MIN_ENTRIES = 4;

/**
 * Run the full clustering + summary pipeline.
 * Safe to call repeatedly — themes are replaced on each run.
 *
 * @returns {Promise<{ skipped: boolean, reason?: string, themes: number }>}
 */
async function runClustering() {
  const db = await openDb();

  // 1. Fetch all embeddings
  const rows = db.prepare(`
    SELECT e.entry_id, e.vector, en.content
    FROM embeddings e
    JOIN entries en ON en.id = e.entry_id
  `).all();

  if (rows.length < MIN_ENTRIES) {
    return { skipped: true, reason: `need at least ${MIN_ENTRIES} embeddings, have ${rows.length}`, themes: 0 };
  }

  // Decode vectors
  const vectors = rows.map((r) => {
    const bytes = new Uint8Array(r.vector);
    return new Float32Array(bytes.buffer);
  });

  // 2. Choose k heuristically
  const k = Math.max(2, Math.min(20, Math.round(Math.sqrt(rows.length / 2))));

  const { assignments, centroids } = kmeans(vectors, k);

  // 3. Group by cluster
  const clusters = Array.from({ length: k }, () => []);
  for (let i = 0; i < rows.length; i++) {
    clusters[assignments[i]].push({ row: rows[i], vector: vectors[i] });
  }

  // Remove empty clusters (can happen with small n)
  const nonEmpty = clusters.filter((c) => c.length > 0);

  const ollamaUp = await isOllamaAvailable();

  // 4. Upsert themes — stable IDs based on sorted centroid fingerprint to
  //    avoid creating duplicates on repeated runs.  We derive a deterministic
  //    theme index by sorting existing themes list and matching by position.
  const existingThemes = await listThemes();
  const themeCount = nonEmpty.length;

  // Extend or reuse existing theme IDs
  const themeIds = [];
  for (let i = 0; i < themeCount; i++) {
    if (existingThemes[i]) {
      themeIds.push(existingThemes[i].id);
    } else {
      themeIds.push(undefined); // upsertTheme will generate a new UUID
    }
  }

  // Delete themes that are no longer needed (cluster count shrank)
  if (existingThemes.length > themeCount) {
    const toDelete = existingThemes.slice(themeCount);
    const del = db.prepare('DELETE FROM themes WHERE id = ?');
    for (const t of toDelete) del.run(t.id);
  }

  for (let i = 0; i < nonEmpty.length; i++) {
    const members = nonEmpty[i];
    const centroid = centroids[assignments.indexOf(i)] || centroids[i];

    // Score each member by cosine similarity to centroid
    const scored = members.map(({ row, vector }) => ({
      entryId: row.entry_id,
      content: row.content,
      score: cosineSimilarity(vector, centroid),
    })).sort((a, b) => b.score - a.score);

    // Draft a name from the top entry's first 40 chars until LLM can do better
    const draftName = `Theme ${i + 1}`;

    // Generate LLM summary if Ollama is available
    let description = '';
    if (ollamaUp) {
      try {
        const topContent = scored.slice(0, 5).map((m, n) => `${n + 1}. ${m.content}`).join('\n');
        const prompt =
          `You are a personal knowledge assistant. The following are a cluster of related notes:\n\n${topContent}\n\n` +
          `In one concise sentence (max 20 words), summarise what these notes are about. ` +
          `Reply with the summary only, no preamble.`;
        description = await generateTextCompletion(prompt);
      } catch (err) {
        console.warn(`[clustering] LLM summary failed for cluster ${i}:`, err.message);
      }
    }

    const theme = await upsertTheme({
      id: themeIds[i],
      name: draftName,
      description,
    });

    await setThemeEntries(
      theme.id,
      scored.map(({ entryId, score }) => ({ entryId, score }))
    );
  }

  return { skipped: false, themes: nonEmpty.length };
}

// ── Minimal Ollama text completion (non-streaming) ────────────────────────────

function generateTextCompletion(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: config.ollama.llmModel,
      prompt,
      stream: false,
    });
    const url = new URL(config.ollama.baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve((json.response || '').trim());
        } catch (e) {
          reject(new Error(`LLM response parse error: ${e.message}`));
        }
      });
    });
    req.setTimeout(60000, () => req.destroy(new Error('LLM request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { runClustering };
