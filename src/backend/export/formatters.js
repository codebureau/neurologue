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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown date';
  const d = new Date(dateStr);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

module.exports = { entriesToJson, themesToJson, entriesToMarkdown, themesToMarkdown, embeddingsToJsonl };
