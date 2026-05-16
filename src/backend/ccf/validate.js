'use strict';

/**
 * CCF Validation Tool
 *
 * validateCCF(folderPath) → { ok: boolean, errors: string[] }
 *
 * Checks a Canonical Corpus Format snapshot folder for structural validity
 * before it is used by the import engine or an export adapter.
 *
 * All checks are pure filesystem operations — no DB access.
 *
 * Checks performed:
 *   1. Required files exist (entries.jsonl, themes.json, metadata.json)
 *   2. JSON files parse correctly
 *   3. Entry IDs are unique within entries.jsonl
 *   4. Theme IDs are unique within themes.json
 *   5. All media files referenced by entries exist on disk
 *   6. All entry_ids referenced by entries exist in embeddings/entries.jsonl
 *   7. metadata.json contains required top-level fields
 */

const fs   = require('fs');
const path = require('path');

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Attempt to parse a JSON string, returning { ok, value, error }.
 * @param {string} text
 * @returns {{ ok: boolean, value?: any, error?: string }}
 */
function tryParseJSON(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Parse entries.jsonl — returns an array of { ok, value, lineNumber } objects.
 * Lines that are blank are skipped.
 * @param {string} text
 * @returns {{ ok: boolean, value?: object, lineNumber: number, error?: string }[]}
 */
function parseJsonl(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line: line.trim(), lineNumber: i + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, lineNumber }) => {
      const result = tryParseJSON(line);
      return result.ok
        ? { ok: true, value: result.value, lineNumber }
        : { ok: false, lineNumber, error: result.error };
    });
}

// ── Main validator ────────────────────────────────────────────────────────────

/**
 * Validate a CCF snapshot folder.
 *
 * @param {string} folderPath  Absolute path to the CCF snapshot folder.
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateCCF(folderPath) {
  const errors = [];

  function err(msg) { errors.push(msg); }

  // ── 1. Required files ───────────────────────────────────────────────────
  const required = ['entries.jsonl', 'themes.json', 'metadata.json'];
  for (const file of required) {
    if (!fs.existsSync(path.join(folderPath, file))) {
      err(`Missing required file: ${file}`);
    }
  }

  // If any required file is missing we cannot continue — further checks
  // would throw misleading errors.
  if (errors.length > 0) return { ok: false, errors };

  // ── 2. Parse required files ─────────────────────────────────────────────
  const entriesText = fs.readFileSync(path.join(folderPath, 'entries.jsonl'), 'utf8');
  const themesText  = fs.readFileSync(path.join(folderPath, 'themes.json'),   'utf8');
  const metaText    = fs.readFileSync(path.join(folderPath, 'metadata.json'), 'utf8');

  // metadata.json
  const metaParsed = tryParseJSON(metaText);
  if (!metaParsed.ok) {
    err(`metadata.json is not valid JSON: ${metaParsed.error}`);
    return { ok: false, errors };
  }
  const metadata = metaParsed.value;

  // themes.json
  const themesParsed = tryParseJSON(themesText);
  if (!themesParsed.ok) {
    err(`themes.json is not valid JSON: ${themesParsed.error}`);
  }
  const themes = themesParsed.ok && Array.isArray(themesParsed.value)
    ? themesParsed.value
    : null;
  if (themesParsed.ok && !Array.isArray(themesParsed.value)) {
    err('themes.json must be a JSON array');
  }

  // entries.jsonl
  const entryLines = parseJsonl(entriesText);
  for (const line of entryLines) {
    if (!line.ok) {
      err(`entries.jsonl line ${line.lineNumber}: invalid JSON — ${line.error}`);
    }
  }
  const entries = entryLines.filter((l) => l.ok).map((l) => l.value);

  // ── 3. Entry IDs unique ─────────────────────────────────────────────────
  const entryIds = new Set();
  for (const entry of entries) {
    if (!entry.id) {
      err('entries.jsonl: entry is missing required field "id"');
      continue;
    }
    if (entryIds.has(entry.id)) {
      err(`entries.jsonl: duplicate entry id "${entry.id}"`);
    } else {
      entryIds.add(entry.id);
    }
  }

  // ── 4. Theme IDs unique ─────────────────────────────────────────────────
  if (themes) {
    const themeIds = new Set();
    for (const theme of themes) {
      if (!theme.id) {
        err('themes.json: theme is missing required field "id"');
        continue;
      }
      if (themeIds.has(theme.id)) {
        err(`themes.json: duplicate theme id "${theme.id}"`);
      } else {
        themeIds.add(theme.id);
      }
    }
  }

  // ── 5. Referenced media files exist ─────────────────────────────────────
  for (const entry of entries) {
    const refs = Array.isArray(entry.media_refs) ? entry.media_refs : [];
    for (const ref of refs) {
      if (!ref.path) {
        err(`Entry "${entry.id}": media_ref is missing "path" field`);
        continue;
      }
      const mediaPath = path.join(folderPath, ref.path);
      if (!fs.existsSync(mediaPath)) {
        err(`Entry "${entry.id}": referenced media file not found: ${ref.path}`);
      }
    }
  }

  // ── 6. Embeddings exist for all entries ─────────────────────────────────
  const embPath = path.join(folderPath, 'embeddings', 'entries.jsonl');
  if (fs.existsSync(embPath)) {
    const embText  = fs.readFileSync(embPath, 'utf8');
    const embLines = parseJsonl(embText);

    for (const line of embLines) {
      if (!line.ok) {
        err(`embeddings/entries.jsonl line ${line.lineNumber}: invalid JSON — ${line.error}`);
      }
    }

    const embeddedIds = new Set(
      embLines.filter((l) => l.ok && l.value.entry_id).map((l) => l.value.entry_id),
    );

    for (const id of entryIds) {
      if (!embeddedIds.has(id)) {
        err(`Entry "${id}": no embedding found in embeddings/entries.jsonl`);
      }
    }
  }
  // Note: absence of embeddings/entries.jsonl is not an error — embeddings
  // are optional (a fresh import may not have them yet).

  // ── 7. metadata.json required fields ────────────────────────────────────
  const requiredMetaFields = ['format_version', 'exported_at', 'app', 'notes'];
  for (const field of requiredMetaFields) {
    if (!(field in metadata)) {
      err(`metadata.json: missing required field "${field}"`);
    }
  }
  if (metadata.app && typeof metadata.app !== 'object') {
    err('metadata.json: "app" must be an object');
  }
  if (metadata.notes && typeof metadata.notes !== 'object') {
    err('metadata.json: "notes" must be an object');
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { validateCCF };
