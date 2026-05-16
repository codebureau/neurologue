'use strict';

/**
 * Copilot-ready export adapter — CCF → grounding-optimised Markdown bundle
 *
 * Satisfies the adapter registry contract (id, name, description, export()).
 *
 * Optimised for Microsoft Copilot (and similar RAG systems) as grounding
 * documents:
 *   - Entries longer than CHUNK_WORDS words are split into numbered chunk files
 *     so no single file is too large for a context window.
 *   - Clear heading hierarchy (H1 = theme, H2 = entry) for predictable chunking.
 *   - Each file begins with the theme summary for context.
 *   - An index.md lists all generated files with entry/chunk counts.
 *
 * Output structure:
 *   <destDir>/
 *     index.md               ← manifest of all files
 *     <theme-slug>.md        ← theme entries (short themes, ≤ CHUNK_WORDS words total)
 *     <theme-slug>-1.md      ← chunk 1 of a long theme
 *     <theme-slug>-2.md      ← chunk 2 …
 *     uncategorized.md       ← unthemed entries (split the same way)
 *     metadata.json
 */

const fs   = require('fs');
const path = require('path');

// ── constants ─────────────────────────────────────────────────────────────────

/** Maximum words in a single output file before a new chunk is started. */
const CHUNK_WORDS = 500;

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

function countWords(text) {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

// ── chunk builder ─────────────────────────────────────────────────────────────

/**
 * Split an array of entries into chunks, each containing at most CHUNK_WORDS
 * words (measured across all entry text in the chunk).
 * @param {object[]} entries
 * @returns {object[][]}  Array of entry-arrays (chunks)
 */
function chunkEntries(entries) {
  const chunks  = [];
  let current   = [];
  let wordCount = 0;

  for (const entry of entries) {
    const words = countWords(entry.text);
    // Start a new chunk when adding this entry would exceed the limit,
    // but always include at least one entry per chunk.
    if (current.length > 0 && wordCount + words > CHUNK_WORDS) {
      chunks.push(current);
      current   = [];
      wordCount = 0;
    }
    current.push(entry);
    wordCount += words;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [[]];
}

// ── content builders ──────────────────────────────────────────────────────────

function buildChunkFile(theme, entries, chunkIndex, totalChunks) {
  const themeName = theme ? theme.name || 'Unnamed Theme' : 'Uncategorized';
  const summary   = theme ? (theme.summary || theme.description || '') : '';
  const chunkLabel = totalChunks > 1 ? ` (part ${chunkIndex + 1} of ${totalChunks})` : '';

  const lines = [];
  lines.push(`# ${themeName}${chunkLabel}`);
  lines.push('');

  if (summary) {
    lines.push(`> ${summary}`);
    lines.push('');
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    lines.push(`## Entry ${i + 1} — ${fmtDate(entry.created_at)}`);
    lines.push('');

    const tags = (entry.tags || []).join(', ');
    if (tags)         lines.push(`**Tags:** ${tags}  `);
    if (entry.domain) lines.push(`**Domain:** ${entry.domain}  `);
    if (tags || entry.domain) lines.push('');

    lines.push(entry.text || '');
    lines.push('');
  }

  return lines.join('\n');
}

// ── adapter ───────────────────────────────────────────────────────────────────

module.exports = {
  id:          'copilot',
  name:        'Copilot-ready',
  description: 'Grounding-optimised Markdown bundle — chunked for Copilot and RAG systems',

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
    const indexRows = [];

    const entryMap  = new Map(entries.map((e) => [e.id, e]));
    const themedIds = new Set(themes.flatMap((t) => t.entry_ids || []));

    // ── themed sections ───────────────────────────────────────────────────
    for (const theme of themes) {
      const memberEntries = (theme.entry_ids || [])
        .map((id) => entryMap.get(id))
        .filter(Boolean)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

      const slug   = slugify(theme.name);
      const chunks = chunkEntries(memberEntries);

      for (let ci = 0; ci < chunks.length; ci++) {
        const fileName = chunks.length === 1 ? `${slug}.md` : `${slug}-${ci + 1}.md`;
        const filePath = path.join(destDir, fileName);
        fs.writeFileSync(filePath, buildChunkFile(theme, chunks[ci], ci, chunks.length), 'utf8');
        files.push(filePath);
        indexRows.push({ file: fileName, theme: theme.name, entries: chunks[ci].length, chunk: chunks.length > 1 ? `${ci + 1}/${chunks.length}` : null });
      }
    }

    // ── uncategorized ─────────────────────────────────────────────────────
    const unthemed = entries
      .filter((e) => !themedIds.has(e.id))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    if (unthemed.length > 0) {
      const chunks = chunkEntries(unthemed);
      for (let ci = 0; ci < chunks.length; ci++) {
        const fileName = chunks.length === 1 ? 'uncategorized.md' : `uncategorized-${ci + 1}.md`;
        const filePath = path.join(destDir, fileName);
        fs.writeFileSync(filePath, buildChunkFile(null, chunks[ci], ci, chunks.length), 'utf8');
        files.push(filePath);
        indexRows.push({ file: fileName, theme: 'Uncategorized', entries: chunks[ci].length, chunk: chunks.length > 1 ? `${ci + 1}/${chunks.length}` : null });
      }
    }

    // ── index.md ──────────────────────────────────────────────────────────
    const indexLines = [
      '# Copilot Grounding Index',
      '',
      `_Exported from Neurologue on ${new Date().toISOString().slice(0, 10)}_`,
      '',
      `${entries.length} entries across ${themes.length} themes in ${files.length} files.`,
      '',
      '## Files',
      '',
    ];
    for (const row of indexRows) {
      const chunkNote = row.chunk ? ` (chunk ${row.chunk})` : '';
      indexLines.push(`- **${row.file}** — ${row.theme}${chunkNote}, ${row.entries} ${row.entries === 1 ? 'entry' : 'entries'}`);
    }
    const indexPath = path.join(destDir, 'index.md');
    fs.writeFileSync(indexPath, indexLines.join('\n'), 'utf8');
    files.push(indexPath);

    // ── metadata.json ─────────────────────────────────────────────────────
    const meta = {
      exportedAt:  new Date().toISOString(),
      adapter:     'copilot',
      chunkWords:  CHUNK_WORDS,
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
