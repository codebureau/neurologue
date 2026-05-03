'use strict';

/**
 * Export runner — fetches all data, formats it, and writes files to a
 * user-chosen directory.
 *
 * Output (all in destDir):
 *   entries.json      — all entries as JSON array
 *   entries.md        — all entries as Markdown
 *   themes.json       — themes + summaries as JSON
 *   themes.md         — themes as Markdown
 *   embeddings.jsonl  — all embeddings as JSONL (one per line)
 */

const fs = require('fs');
const path = require('path');
const { openDb } = require('../db/connection');
const { getEntryWithTags } = require('../db/search');
const { listThemes, getEntriesForTheme } = require('../db/themes');
const {
  entriesToJson,
  themesToJson,
  entriesToMarkdown,
  themesToMarkdown,
  embeddingsToJsonl,
} = require('./formatters');

/**
 * Run a full export to destDir.
 *
 * @param {string} destDir  Absolute path to the destination directory
 * @param {object} [opts]
 * @param {boolean} [opts.includeEmbeddings=true]
 * @returns {Promise<{ files: string[], entryCount: number, themeCount: number, embeddingCount: number }>}
 */
async function runExport(destDir, { includeEmbeddings = true } = {}) {
  fs.mkdirSync(destDir, { recursive: true });

  const db = await openDb();

  // ── 1. Entries ────────────────────────────────────────────────────────────
  const rawEntries = db.prepare('SELECT * FROM entries ORDER BY created_at DESC').all();

  // Enrich with tags
  const entries = await Promise.all(rawEntries.map((e) => getEntryWithTags(e.id)));
  const validEntries = entries.filter(Boolean);

  write(destDir, 'entries.json', entriesToJson(validEntries));
  write(destDir, 'entries.md', entriesToMarkdown(validEntries));

  // ── 2. Themes ─────────────────────────────────────────────────────────────
  const themes = await listThemes();
  const enrichedThemes = await Promise.all(
    themes.map(async (t) => {
      const members = await getEntriesForTheme(t.id);
      return { ...t, entries: members };
    })
  );

  write(destDir, 'themes.json', themesToJson(enrichedThemes));
  write(destDir, 'themes.md', themesToMarkdown(enrichedThemes));

  // ── 3. Embeddings ─────────────────────────────────────────────────────────
  let embeddingCount = 0;
  if (includeEmbeddings) {
    const embRows = db.prepare('SELECT entry_id, vector, model_name FROM embeddings').all();
    const embeddings = embRows.map((r) => {
      const bytes = new Uint8Array(r.vector);
      return {
        entry_id: r.entry_id,
        model_name: r.model_name,
        vector: new Float32Array(bytes.buffer),
      };
    });
    write(destDir, 'embeddings.jsonl', embeddingsToJsonl(embeddings));
    embeddingCount = embeddings.length;
  }

  const files = ['entries.json', 'entries.md', 'themes.json', 'themes.md'];
  if (includeEmbeddings) files.push('embeddings.jsonl');

  return {
    files: files.map((f) => path.join(destDir, f)),
    entryCount: validEntries.length,
    themeCount: enrichedThemes.length,
    embeddingCount,
  };
}

function write(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

module.exports = { runExport };
