'use strict';

/**
 * Export formatters — pure functions, no side-effects.
 * Each formatter takes an array of enriched entry objects and returns a string.
 *
 * Enriched entry shape:
 *   { id, content, source, type, created_at, tags: [{ id, name }] }
 */

// ── JSON ──────────────────────────────────────────────────────────────────────

/**
 * Serialise entries to a JSON array.
 * @param {object[]} entries
 * @returns {string}
 */
function entriesToJson(entries) {
  const rows = entries.map((e) => ({
    id: e.id,
    content: e.content,
    source: e.source || 'manual',
    type: e.type || 'note',
    created_at: e.created_at,
    tags: (e.tags || []).map((t) => t.name),
  }));
  return JSON.stringify(rows, null, 2);
}

/**
 * Serialise themes to a JSON array.
 * @param {object[]} themes   Each theme has { id, name, description, entries[] }
 * @returns {string}
 */
function themesToJson(themes) {
  const rows = themes.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.description || '',
    entries: (t.entries || []).map((e) => ({
      id: e.entry_id || e.id,
      score: typeof e.score === 'number' ? parseFloat(e.score.toFixed(4)) : undefined,
    })),
  }));
  return JSON.stringify(rows, null, 2);
}

// ── Markdown ──────────────────────────────────────────────────────────────────

/**
 * Serialise entries to a single Markdown document.
 * Each entry becomes an H2 section.
 * @param {object[]} entries
 * @returns {string}
 */
function entriesToMarkdown(entries) {
  const lines = ['# Neurologue Export\n'];
  for (const e of entries) {
    lines.push(`## ${formatDate(e.created_at)}`);
    lines.push('');
    lines.push(e.content);
    lines.push('');
    const tagStr = (e.tags || []).map((t) => `\`${t.name}\``).join(', ');
    if (tagStr) lines.push(`**Tags:** ${tagStr}`);
    const meta = [`id: ${e.id}`, `source: ${e.source || 'manual'}`, `type: ${e.type || 'note'}`];
    lines.push(`*${meta.join(' · ')}*`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Serialise themes to a Markdown document.
 * @param {object[]} themes
 * @returns {string}
 */
function themesToMarkdown(themes) {
  const lines = ['# Neurologue Themes\n'];
  for (const t of themes) {
    lines.push(`## ${t.name}`);
    lines.push('');
    if (t.description) {
      lines.push(`> ${t.description}`);
      lines.push('');
    }
    if (t.entries && t.entries.length > 0) {
      lines.push(`**${t.entries.length} entries in this theme**`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ── Entries JSONL ─────────────────────────────────────────────────────────────

/**
 * Serialise entries to JSONL — one full entry object per line.
 * Suitable for LLM fine-tuning pipelines and bulk ingest tools.
 * @param {object[]} entries
 * @returns {string}
 */
function entriesToJsonl(entries) {
  return entries
    .map((e) => JSON.stringify({
      id: e.id,
      content: e.content,
      source: e.source || 'manual',
      type: e.type || 'note',
      category: e.user_category || e.category || null,
      created_at: e.created_at,
      edited_at: e.edited_at || null,
      tags: (e.tags || []).map((t) => t.name),
    }))
    .join('\n');
}

// ── Embeddings JSONL ───────────────────────────────────────────────────────────

/**
 * Serialise embeddings to JSONL (one JSON object per line).
 * @param {{ entry_id: string, vector: Float32Array, model_name: string }[]} embeddings
 * @returns {string}
 */
function embeddingsToJsonl(embeddings) {
  return embeddings
    .map((e) => JSON.stringify({
      entry_id: e.entry_id,
      model_name: e.model_name,
      vector: Array.from(e.vector),
    }))
    .join('\n');
}

// ── Markdown bundle helpers ───────────────────────────────────────────────────

/**
 * Produce the content for a single per-entry Markdown file with YAML frontmatter.
 * @param {object} entry
 * @returns {string}
 */
function entryToMarkdownFile(entry) {
  const tags = (entry.tags || []).map((t) => t.name);
  const category = entry.user_category || entry.category || null;
  const lines = [
    '---',
    `id: ${entry.id}`,
    `created_at: "${entry.created_at}"`,
  ];
  if (entry.edited_at) lines.push(`edited_at: "${entry.edited_at}"`);
  if (category) lines.push(`category: ${category}`);
  if (tags.length > 0) lines.push(`tags: [${tags.map((t) => `"${t}"`).join(', ')}]`);
  lines.push(`source: ${entry.source || 'manual'}`);
  lines.push('---');
  lines.push('');
  lines.push(entry.content);
  lines.push('');
  return lines.join('\n');
}

/**
 * Build an index.md linking all per-entry files, grouped by date.
 * @param {object[]} entries  Must be sorted newest-first.
 * @param {Map<string, string>} filenameMap  entry.id → filename
 * @returns {string}
 */
function buildMarkdownIndex(entries, filenameMap) {
  const lines = ['# Neurologue — Entry Index', ''];
  let lastDate = null;
  for (const e of entries) {
    const dateStr = (e.created_at || '').slice(0, 10);
    if (dateStr !== lastDate) {
      if (lastDate !== null) lines.push('');
      lines.push(`## ${dateStr}`);
      lines.push('');
      lastDate = dateStr;
    }
    const filename = filenameMap.get(e.id) || `${e.id}.md`;
    const preview = (e.content || '').slice(0, 80).replace(/\n/g, ' ');
    lines.push(`- [${preview}…](./${filename})`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  const d = new Date(dateStr);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

module.exports = {
  entriesToJson,
  entriesToJsonl,
  themesToJson,
  entriesToMarkdown,
  themesToMarkdown,
  embeddingsToJsonl,
  entryToMarkdownFile,
  buildMarkdownIndex,
};
