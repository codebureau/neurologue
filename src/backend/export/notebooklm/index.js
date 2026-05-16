'use strict';

/**
 * NotebookLM export adapter — CCF → Markdown folder
 *
 * Satisfies the adapter registry contract (id, name, description, export()).
 *
 * Output structure:
 *   <destDir>/
 *     <theme-slug>.md        ← one file per theme; theme summary + all member entries
 *     uncategorized.md       ← entries not belonging to any theme (omitted if empty)
 *     metadata.json          ← export timestamp, counts
 *
 * File naming is deterministic: slugified theme name, truncated to 60 chars.
 * NotebookLM ingests folders of Markdown files as "sources".
 */

const fs   = require('fs');
const path = require('path');

// ── helpers ───────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => JSON.parse(l));
}

function readJson(filePath, def = null) {
  if (!fs.existsSync(filePath)) return def;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function slugify(name) {
  return (name || 'unnamed')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unnamed';
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

// ── content builders ──────────────────────────────────────────────────────────

function buildThemeFile(theme, entries) {
  const lines = [];
  lines.push(`# ${theme.name || 'Unnamed Theme'}`);
  lines.push('');

  if (theme.summary || theme.description) {
    lines.push(theme.summary || theme.description);
    lines.push('');
  }

  lines.push(`_${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}_`);
  lines.push('');
  lines.push('---');

  for (const entry of entries) {
    lines.push('');
    lines.push(`## Entry — ${fmtDate(entry.created_at)}`);
    lines.push('');

    const tags = (entry.tags || []).join(', ');
    if (tags)         lines.push(`**Tags:** ${tags}`);
    if (entry.domain) lines.push(`**Domain:** ${entry.domain}`);
    lines.push('');

    lines.push(entry.text || '');
    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

function buildUncategorizedFile(entries) {
  const lines = [];
  lines.push('# Uncategorized Entries');
  lines.push('');
  lines.push(`_${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} not assigned to a theme_`);
  lines.push('');
  lines.push('---');

  for (const entry of entries) {
    lines.push('');
    lines.push(`## Entry — ${fmtDate(entry.created_at)}`);
    lines.push('');

    const tags = (entry.tags || []).join(', ');
    if (tags)         lines.push(`**Tags:** ${tags}`);
    if (entry.domain) lines.push(`**Domain:** ${entry.domain}`);
    lines.push('');

    lines.push(entry.text || '');
    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

// ── adapter ───────────────────────────────────────────────────────────────────

module.exports = {
  id:          'notebooklm',
  name:        'NotebookLM',
  description: 'Markdown folder — one file per theme, ready to upload as NotebookLM sources',

  /**
   * @param {string} ccfSnapshotDir  Absolute path to a CCF snapshot folder.
   * @param {string} destDir         Absolute path for output (created if needed).
   * @returns {{ files: string[], entryCount: number, themeCount: number }}
   */
  export(ccfSnapshotDir, destDir) {
    fs.mkdirSync(destDir, { recursive: true });

    const entries = readJsonl(path.join(ccfSnapshotDir, 'entries.jsonl'));
    const themes  = readJson(path.join(ccfSnapshotDir, 'themes.json'), []);
    const files   = [];

    const entryMap  = new Map(entries.map((e) => [e.id, e]));
    const themedIds = new Set(themes.flatMap((t) => t.entry_ids || []));

    // ── one file per theme ────────────────────────────────────────────────
    for (const theme of themes) {
      const memberEntries = (theme.entry_ids || [])
        .map((id) => entryMap.get(id))
        .filter(Boolean)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

      const slug     = slugify(theme.name);
      const filePath = path.join(destDir, `${slug}.md`);
      fs.writeFileSync(filePath, buildThemeFile(theme, memberEntries), 'utf8');
      files.push(filePath);
    }

    // ── uncategorized ─────────────────────────────────────────────────────
    const unthemed = entries
      .filter((e) => !themedIds.has(e.id))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    if (unthemed.length > 0) {
      const filePath = path.join(destDir, 'uncategorized.md');
      fs.writeFileSync(filePath, buildUncategorizedFile(unthemed), 'utf8');
      files.push(filePath);
    }

    // ── metadata ──────────────────────────────────────────────────────────
    const meta = {
      exportedAt:  new Date().toISOString(),
      adapter:     'notebooklm',
      entryCount:  entries.length,
      themeCount:  themes.length,
      fileCount:   files.length,
    };
    const metaPath = path.join(destDir, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    files.push(metaPath);

    return { files, entryCount: entries.length, themeCount: themes.length };
  },
};
