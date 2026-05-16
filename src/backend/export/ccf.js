'use strict';

/**
 * Canonical Corpus Format (CCF) Export Engine.
 *
 * Produces a versioned, portable snapshot of the entire corpus:
 *
 *   <destDir>/
 *     entries.jsonl          — one CCF entry object per line
 *     themes.json            — array of CCF theme objects
 *     embeddings/
 *       entries.jsonl        — one CCF embedding object per line
 *     metadata.json          — format version, app version, export timestamp
 *
 * See docs/architecture/07-canonical-corpus-format.md for the full spec.
 */

const fs   = require('fs');
const path = require('path');
const { openDb }            = require('../db/connection');
const { getEntryWithTags }  = require('../db/search');
const { listThemes, getEntriesForTheme } = require('../db/themes');

const FORMAT_VERSION = '1.0.0';

// ── Schema mappers ─────────────────────────────────────────────────────────────

/**
 * Map an internal enriched entry + theme-id lookup to the CCF entry schema.
 *
 * @param {object}            entry            — enriched entry row (with .tags[])
 * @param {Map<string, string[]>} themeIdsByEntry — entry_id → [theme_id, …]
 * @returns {object}
 */
function toCCFEntry(entry, themeIdsByEntry) {
  return {
    id:         entry.id,
    created_at: entry.created_at,
    updated_at: entry.edited_at || entry.created_at,
    text:       entry.content,
    source: {
      type:        'user',
      app:         'neurologue',
      external_id: null,
    },
    domain:     'personal',
    tags:       (entry.tags || []).map((t) => t.name),
    theme_ids:  (themeIdsByEntry && themeIdsByEntry.get(entry.id)) || [],
    media_refs: [],
    metadata: {
      pinned:   false,
      archived: false,
      custom:   {},
    },
  };
}

/**
 * Map an enriched internal theme (with .entries[]) to the CCF theme schema.
 *
 * @param {object} theme — theme row enriched with .entries[] (from getEntriesForTheme)
 * @returns {object}
 */
function toCCFTheme(theme) {
  const entries   = theme.entries || [];
  const entryIds  = entries.map((e) => e.entry_id || e.id);
  const createdAts = entries
    .map((e) => e.created_at)
    .filter(Boolean)
    .sort();

  return {
    id:         theme.id,
    name:       theme.display_name || theme.name,
    created_at: theme.created_at  || null,
    updated_at: theme.updated_at  || null,
    summary:    theme.description || '',
    entry_ids:  entryIds,
    metrics: {
      entry_count:    entryIds.length,
      first_entry_at: createdAts[0]                         || null,
      last_entry_at:  createdAts[createdAts.length - 1]     || null,
    },
    metadata: {
      color:  null,
      custom: {},
    },
  };
}

// ── Engine ─────────────────────────────────────────────────────────────────────

/**
 * Export the full corpus as a Canonical Corpus Format (CCF) snapshot.
 *
 * @param {string} destDir  Absolute path to the output directory (created if absent).
 * @returns {Promise<{
 *   dir:             string,
 *   entryCount:      number,
 *   themeCount:      number,
 *   embeddingCount:  number,
 *   embeddingModel:  string|null,
 *   dimension:       number|null,
 * }>}
 */
async function exportCCF(destDir) {
  fs.mkdirSync(path.join(destDir, 'embeddings'), { recursive: true });

  const db = await openDb();

  // ── Entries ──────────────────────────────────────────────────────────────
  const rawEntries = db
    .prepare('SELECT * FROM entries ORDER BY created_at DESC')
    .all();
  const entries = (
    await Promise.all(rawEntries.map((e) => getEntryWithTags(e.id)))
  ).filter(Boolean);

  // ── Themes ───────────────────────────────────────────────────────────────
  const themeRows = await listThemes();
  const themes = await Promise.all(
    themeRows.map(async (t) => {
      const members = await getEntriesForTheme(t.id);
      return { ...t, entries: members };
    }),
  );

  // Build entry_id → [theme_id, …] for the entries.jsonl theme_ids field
  const themeIdsByEntry = new Map();
  for (const t of themes) {
    for (const e of t.entries) {
      const eid = e.entry_id || e.id;
      if (!themeIdsByEntry.has(eid)) themeIdsByEntry.set(eid, []);
      themeIdsByEntry.get(eid).push(t.id);
    }
  }

  // ── Write entries.jsonl ──────────────────────────────────────────────────
  const entriesJsonl = entries
    .map((e) => JSON.stringify(toCCFEntry(e, themeIdsByEntry)))
    .join('\n');
  fs.writeFileSync(path.join(destDir, 'entries.jsonl'), entriesJsonl, 'utf8');

  // ── Write themes.json ────────────────────────────────────────────────────
  fs.writeFileSync(
    path.join(destDir, 'themes.json'),
    JSON.stringify(themes.map(toCCFTheme), null, 2),
    'utf8',
  );

  // ── Embeddings ────────────────────────────────────────────────────────────
  const embRows = db
    .prepare('SELECT entry_id, vector, model_name FROM embeddings')
    .all();

  let embeddingModel = null;
  let dimension      = null;

  const embeddingsJsonl = embRows
    .map((r) => {
      const vec = Array.from(new Float32Array(new Uint8Array(r.vector).buffer));
      if (!embeddingModel) { embeddingModel = r.model_name; dimension = vec.length; }
      return JSON.stringify({
        entry_id: r.entry_id,
        model:    r.model_name,
        vector:   vec,
      });
    })
    .join('\n');

  fs.writeFileSync(
    path.join(destDir, 'embeddings', 'entries.jsonl'),
    embeddingsJsonl,
    'utf8',
  );

  // ── Write metadata.json ──────────────────────────────────────────────────
  // eslint-disable-next-line import/no-dynamic-require
  const { version } = require(path.resolve(__dirname, '../../../package.json'));

  const metadata = {
    format_version: FORMAT_VERSION,
    exported_at:    new Date().toISOString(),
    app: {
      name:    'Neurologue',
      version,
    },
    embedding: {
      model:     embeddingModel,
      dimension,
    },
    notes: {
      entry_count: entries.length,
      theme_count: themes.length,
    },
    custom: {},
  };

  fs.writeFileSync(
    path.join(destDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );

  return {
    dir:            destDir,
    entryCount:     entries.length,
    themeCount:     themes.length,
    embeddingCount: embRows.length,
    embeddingModel,
    dimension,
  };
}

module.exports = { exportCCF, toCCFEntry, toCCFTheme };
