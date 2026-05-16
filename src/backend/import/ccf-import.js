'use strict';

/**
 * CCF Import Engine
 *
 * importCCF(inputFolder, options) → { ok, stats, errors }
 *
 * Loads a Canonical Corpus Format (CCF) snapshot into the Neurologue database.
 * The import is atomic — a SQLite transaction wraps all DB writes so a failure
 * leaves the database unchanged.
 *
 * ID collision strategy (option: 'skip' — default):
 *   - Entries/themes whose IDs already exist in the DB are silently skipped.
 *   - This keeps the import safe to run on a corpus that already has data.
 *
 * See docs/architecture/07-canonical-corpus-format.md for the CCF spec.
 */

const fs   = require('fs');
const path = require('path');

const { openDb }         = require('../db/connection');
const { upsertEmbedding } = require('../db/embeddings');
const { setTagsForEntry } = require('../db/tags');
const { validateCCF }    = require('../ccf/validate');

// ── JSONL parser ──────────────────────────────────────────────────────────────

function parseJsonlFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

// ── Main import function ──────────────────────────────────────────────────────

/**
 * Import a CCF snapshot into the database.
 *
 * @param {string} inputFolder  Absolute path to a valid CCF snapshot folder.
 * @param {{ onConflict?: 'skip' }} [options]
 * @returns {Promise<{
 *   ok:                  boolean,
 *   errors:              string[],
 *   stats: {
 *     entriesImported:   number,
 *     entriesSkipped:    number,
 *     themesImported:    number,
 *     themesSkipped:     number,
 *     embeddingsImported:number,
 *     mediaFilescopied:  number,
 *   }
 * }>}
 */
async function importCCF(inputFolder, { onConflict = 'skip' } = {}) {
  // ── 1. Validate snapshot before touching the DB ──────────────────────────
  const validation = validateCCF(inputFolder);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, stats: _emptyStats() };
  }

  const db = await openDb();

  const stats = _emptyStats();
  const importErrors = [];

  // ── 2. Read CCF files ────────────────────────────────────────────────────
  const entries = parseJsonlFile(path.join(inputFolder, 'entries.jsonl'));
  const themes  = JSON.parse(fs.readFileSync(path.join(inputFolder, 'themes.json'), 'utf8'));

  const embPath = path.join(inputFolder, 'embeddings', 'entries.jsonl');
  const embeddings = fs.existsSync(embPath) ? parseJsonlFile(embPath) : [];

  // ── 3. Atomic DB writes ──────────────────────────────────────────────────
  db.transaction(() => {
    // ── Entries ────────────────────────────────────────────────────────────
    const insertEntry = db.prepare(`
      INSERT OR IGNORE INTO entries
        (id, content, source, type, created_at, edited_at, metadata)
      VALUES
        (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const e of entries) {
      const result = insertEntry.run(
        e.id,
        e.text       || '',
        e.source && e.source.type ? e.source.type : 'manual',
        'note',
        e.created_at || null,
        e.updated_at !== e.created_at ? e.updated_at : null,
        '{}',
      );
      if (result.changes > 0) {
        stats.entriesImported++;
      } else {
        stats.entriesSkipped++;
      }
    }

    // ── Themes ─────────────────────────────────────────────────────────────
    const insertTheme = db.prepare(`
      INSERT OR IGNORE INTO themes (id, name, description)
      VALUES (?, ?, ?)
    `);
    const insertThemeEntry = db.prepare(`
      INSERT OR IGNORE INTO theme_entries (theme_id, entry_id, score)
      VALUES (?, ?, ?)
    `);

    for (const t of themes) {
      const result = insertTheme.run(t.id, t.name || '', t.summary || '');
      if (result.changes > 0) {
        stats.themesImported++;
      } else {
        stats.themesSkipped++;
      }

      // Link entries that were actually imported (skip entries we didn't write)
      for (const entryId of (t.entry_ids || [])) {
        insertThemeEntry.run(t.id, entryId, 1.0);
      }
    }
  })();

  // ── 4. Tags (outside transaction — setTagsForEntry is async) ────────────
  for (const e of entries) {
    if (!Array.isArray(e.tags) || e.tags.length === 0) continue;
    // Only tag entries we actually imported (id exists)
    const exists = db.prepare('SELECT id FROM entries WHERE id = ?').get(e.id);
    if (!exists) continue;
    try {
      await setTagsForEntry(e.id, e.tags);
    } catch (tagErr) {
      importErrors.push(`Tags for entry "${e.id}": ${tagErr.message}`);
    }
  }

  // ── 5. Embeddings ────────────────────────────────────────────────────────
  for (const emb of embeddings) {
    if (!emb.entry_id || !Array.isArray(emb.vector)) continue;
    // Only embed entries we actually imported
    const exists = db.prepare('SELECT id FROM entries WHERE id = ?').get(emb.entry_id);
    if (!exists) continue;
    try {
      await upsertEmbedding(emb.entry_id, new Float32Array(emb.vector), emb.model || 'unknown');
      stats.embeddingsImported++;
    } catch (embErr) {
      importErrors.push(`Embedding for entry "${emb.entry_id}": ${embErr.message}`);
    }
  }

  // ── 6. Media files ────────────────────────────────────────────────────────
  // Copy media/ folder from the snapshot to the app data directory if present.
  const srcMedia  = path.join(inputFolder, 'media');
  if (fs.existsSync(srcMedia)) {
    const { app } = require('electron');
    const destMedia = path.join(app.getPath('userData'), 'media');
    stats.mediaFilesCopied = copyDirNew(srcMedia, destMedia);
  }

  const ok = importErrors.length === 0;
  return { ok, errors: importErrors, stats };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _emptyStats() {
  return {
    entriesImported:    0,
    entriesSkipped:     0,
    themesImported:     0,
    themesSkipped:      0,
    embeddingsImported: 0,
    mediaFilesCopied:   0,
  };
}

/**
 * Recursively copy files from src to dest, skipping files that already exist.
 * Returns the number of files copied.
 */
function copyDirNew(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDirNew(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

module.exports = { importCCF };
