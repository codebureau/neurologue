'use strict';

/**
 * CCF Diff Engine
 *
 * Compares two CCF snapshot folders and produces a structured diff.
 * Operates purely on snapshot files — no DB access.
 *
 * @see docs/architecture/07-canonical-corpus-format.md
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Read a .jsonl file and return an array of parsed objects.
 * Empty or missing files return [].
 */
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

/**
 * Read a .json file and return the parsed value.
 * Returns the supplied default if the file is missing.
 */
function readJson(filePath, defaultValue = null) {
  if (!fs.existsSync(filePath)) return defaultValue;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Build a Map<id, entry> from an entries.jsonl array.
 */
function indexById(arr) {
  const map = new Map();
  for (const item of arr) {
    if (item && item.id) map.set(item.id, item);
  }
  return map;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Compare two CCF snapshot folders and return a structured diff.
 *
 * @param {string} oldSnapshotDir  Path to the older CCF snapshot folder.
 * @param {string} newSnapshotDir  Path to the newer CCF snapshot folder.
 * @returns {{
 *   addedEntries:   object[],
 *   updatedEntries: { id: string, before: object, after: object }[],
 *   deletedEntries: { id: string, entry: object }[],
 *   themeChanges:   {
 *     id: string,
 *     name: string,
 *     status: 'added'|'removed'|'modified',
 *     addedEntryIds:   string[],
 *     removedEntryIds: string[],
 *   }[],
 * }}
 */
function diffCCF(oldSnapshotDir, newSnapshotDir) {
  // ── load entries ──────────────────────────────────────────────────────────
  const oldEntries = indexById(readJsonl(path.join(oldSnapshotDir, 'entries.jsonl')));
  const newEntries = indexById(readJsonl(path.join(newSnapshotDir, 'entries.jsonl')));

  // Added: present in new, absent in old
  const addedEntries = [];
  for (const [id, entry] of newEntries) {
    if (!oldEntries.has(id)) addedEntries.push(entry);
  }
  // Sort for determinism
  addedEntries.sort((a, b) => a.id.localeCompare(b.id));

  // Updated: present in both, but updated_at has changed
  const updatedEntries = [];
  for (const [id, newEntry] of newEntries) {
    const oldEntry = oldEntries.get(id);
    if (oldEntry && oldEntry.updated_at !== newEntry.updated_at) {
      updatedEntries.push({ id, before: oldEntry, after: newEntry });
    }
  }
  updatedEntries.sort((a, b) => a.id.localeCompare(b.id));

  // Deleted: present in old, absent in new
  const deletedEntries = [];
  for (const [id, entry] of oldEntries) {
    if (!newEntries.has(id)) deletedEntries.push({ id, entry });
  }
  deletedEntries.sort((a, b) => a.id.localeCompare(b.id));

  // ── load themes ───────────────────────────────────────────────────────────
  const oldThemes = readJson(path.join(oldSnapshotDir, 'themes.json'), []);
  const newThemes = readJson(path.join(newSnapshotDir, 'themes.json'), []);

  const oldThemeMap = indexById(oldThemes);
  const newThemeMap = indexById(newThemes);

  const themeChanges = [];

  // Added themes
  for (const [id, theme] of newThemeMap) {
    if (!oldThemeMap.has(id)) {
      themeChanges.push({
        id,
        name: theme.name,
        status: 'added',
        addedEntryIds:   (theme.entry_ids || []).slice().sort(),
        removedEntryIds: [],
      });
    }
  }

  // Removed themes
  for (const [id, theme] of oldThemeMap) {
    if (!newThemeMap.has(id)) {
      themeChanges.push({
        id,
        name: theme.name,
        status: 'removed',
        addedEntryIds:   [],
        removedEntryIds: (theme.entry_ids || []).slice().sort(),
      });
    }
  }

  // Modified themes — same ID, check membership
  for (const [id, newTheme] of newThemeMap) {
    const oldTheme = oldThemeMap.get(id);
    if (!oldTheme) continue;

    const oldIds = new Set(oldTheme.entry_ids || []);
    const newIds = new Set(newTheme.entry_ids || []);

    const addedEntryIds   = [...newIds].filter((eid) => !oldIds.has(eid)).sort();
    const removedEntryIds = [...oldIds].filter((eid) => !newIds.has(eid)).sort();

    if (addedEntryIds.length > 0 || removedEntryIds.length > 0) {
      themeChanges.push({
        id,
        name:   newTheme.name,
        status: 'modified',
        addedEntryIds,
        removedEntryIds,
      });
    }
  }

  themeChanges.sort((a, b) => a.id.localeCompare(b.id));

  return { addedEntries, updatedEntries, deletedEntries, themeChanges };
}

module.exports = { diffCCF };
