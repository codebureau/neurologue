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
const { getSettings } = require('../settings');
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

    // Use LLM to generate a descriptive name, or fall back to positional draft
    let themeName = `Theme ${i + 1}`;
    let description = '';
    if (ollamaUp) {
      const topContent = scored.slice(0, 5).map((m, n) => `${n + 1}. ${m.content}`).join('\n');

      // Generate description first so it can serve as name fallback
      try {
        const summaryPrompt =
          `You are a personal knowledge assistant. The following are a cluster of related journal entries:\n\n${topContent}\n\n` +
          `Write a 3–5 sentence summary of what these entries are collectively about. ` +
          `Be specific and insightful. Do not use bullet points. Reply with the summary only.`;
        description = await generateTextCompletion(summaryPrompt);
      } catch (err) {
        console.warn(`[clustering] LLM summary failed for cluster ${i}:`, err.message);
      }

      try {
        const namePrompt =
          `You are a personal knowledge assistant. The following are a cluster of related journal entries:\n\n${topContent}\n\n` +
          `Give this cluster a short, meaningful name of 2–4 words that captures its essence. ` +
          `Use title case. Reply with the name only — no punctuation, no explanation.`;
        const raw = await generateTextCompletion(namePrompt);
        // Strip markdown artefacts and clamp to 4 words if LLM returns a sentence
        const cleaned = _cleanThemeName(raw);
        themeName = cleaned || themeName;
      } catch (err) {
        console.warn(`[clustering] LLM name generation failed for cluster ${i}:`, err.message);
      }

      // If name is still a placeholder but we have a description, derive from it
      if (/^Theme \d+$/.test(themeName) && description) {
        const firstWords = description.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
        themeName = firstWords || themeName;
      }
    }

    const theme = await upsertTheme({
      id: themeIds[i],
      name: themeName,
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
      model: getSettings().llmModel,
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

module.exports = { runClustering, _cleanThemeName };

/**
 * Sanitise a raw LLM name response into a clean 2–5 word title.
 * Exported for unit testing.
 * @param {string} raw
 * @returns {string}
 */
function _cleanThemeName(raw) {
  const cleaned = raw
    .replace(/[*_`#>\-]/g, '')  // markdown symbols
    .replace(/^[\s"'\u201c\u201d\u2018\u2019([\]]+|[\s"'\u201c\u201d\u2018\u2019)[\]]+$/g, '') // brackets/quotes
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  // If LLM returned a sentence instead of 2–4 words, take the first 4
  return words.length > 5 ? words.slice(0, 4).join(' ') : cleaned;
}
