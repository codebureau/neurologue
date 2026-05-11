'use strict';

/**
 * Export runner — fetches all data, formats it, and writes files to a
 * user-chosen directory.
 *
 * Supported formats (all enabled by default):
 *   json           — entries.json + themes.json
 *   jsonl          — entries.jsonl (one full entry per line)
 *   markdown       — entries.md + themes.md (flat single-file documents)
 *   markdownBundle — markdown/ subfolder, one .md per entry + index.md + themes/
 *   embeddings     — embeddings.jsonl (raw vectors)
 *   vectorDb       — vectors/ subfolder (copy of the LanceDB store)
 */

const fs   = require('fs');
const path = require('path');
const { openDb } = require('../db/connection');
const { getEntryWithTags } = require('../db/search');
const { listThemes, getEntriesForTheme } = require('../db/themes');
const config = require('../../config');
const {
  entriesToJson,
  entriesToJsonl,
  themesToJson,
  entriesToMarkdown,
  themesToMarkdown,
  embeddingsToJsonl,
  entryToMarkdownFile,
  buildMarkdownIndex,
} = require('./formatters');

/**
 * Run an export to destDir.
 *
 * @param {string} destDir  Absolute path to the destination directory
 * @param {object} [opts]
 * @param {string[]} [opts.formats]  Which formats to include. Defaults to all.
 *   Possible values: 'json', 'jsonl', 'markdown', 'markdownBundle', 'embeddings', 'vectorDb'
 * @returns {Promise<{
 *   files: string[],
 *   entryCount: number,
 *   themeCount: number,
 *   embeddingCount: number
 * }>}
 */
async function runExport(destDir, { formats = ['json', 'jsonl', 'markdown', 'markdownBundle', 'embeddings', 'vectorDb'] } = {}) {
  fs.mkdirSync(destDir, { recursive: true });

  const db = await openDb();
  const files = [];

  // ── Common data ───────────────────────────────────────────────────────────
  const rawEntries = db.prepare('SELECT * FROM entries ORDER BY created_at DESC').all();
  const entries = (await Promise.all(rawEntries.map((e) => getEntryWithTags(e.id)))).filter(Boolean);

  const themes = await listThemes();
  const enrichedThemes = await Promise.all(
    themes.map(async (t) => {
      const members = await getEntriesForTheme(t.id);
      return { ...t, entries: members };
    })
  );

  // ── JSON ──────────────────────────────────────────────────────────────────
  if (formats.includes('json')) {
    write(destDir, 'entries.json', entriesToJson(entries));
    write(destDir, 'themes.json', themesToJson(enrichedThemes));
    files.push('entries.json', 'themes.json');
  }

  // ── JSONL ─────────────────────────────────────────────────────────────────
  if (formats.includes('jsonl')) {
    write(destDir, 'entries.jsonl', entriesToJsonl(entries));
    files.push('entries.jsonl');
  }

  // ── Flat Markdown ─────────────────────────────────────────────────────────
  if (formats.includes('markdown')) {
    write(destDir, 'entries.md', entriesToMarkdown(entries));
    write(destDir, 'themes.md', themesToMarkdown(enrichedThemes));
    files.push('entries.md', 'themes.md');
  }

  // ── Markdown bundle ───────────────────────────────────────────────────────
  if (formats.includes('markdownBundle')) {
    const mdDir = path.join(destDir, 'markdown');
    const themeMdDir = path.join(mdDir, 'themes');
    fs.mkdirSync(themeMdDir, { recursive: true });

    // One file per entry: YYYY-MM-DD-<id-prefix>.md
    const filenameMap = new Map();
    for (const entry of entries) {
      const datePrefix = (entry.created_at || '').slice(0, 10) || 'undated';
      const filename = `${datePrefix}-${entry.id.slice(0, 8)}.md`;
      filenameMap.set(entry.id, filename);
      const filePath = path.join(mdDir, filename);
      fs.writeFileSync(filePath, entryToMarkdownFile(entry), 'utf8');
      files.push(path.relative(destDir, filePath));
    }

    // index.md
    const indexPath = path.join(mdDir, 'index.md');
    fs.writeFileSync(indexPath, buildMarkdownIndex(entries, filenameMap), 'utf8');
    files.push(path.relative(destDir, indexPath));

    // One theme file per theme: themes/<name>.md
    for (const t of enrichedThemes) {
      const safeName = (t.display_name || t.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)          // guard against Windows MAX_PATH on long AI names
        .replace(/-+$/, '');   // strip any trailing dash after truncation
      const themePath = path.join(themeMdDir, `${safeName}.md`);
      const themeLines = [
        `# ${t.display_name || t.name}`,
        '',
        t.description ? `> ${t.description}` : '',
        '',
        '## Entries',
        '',
        ...(t.entries || []).map((e) => {
          const fn = filenameMap.get(e.entry_id || e.id);
          const preview = (e.content || '').slice(0, 80).replace(/\n/g, ' ');
          return fn ? `- [${preview}…](../${fn})` : `- ${preview}…`;
        }),
        '',
      ];
      fs.writeFileSync(themePath, themeLines.join('\n'), 'utf8');
      files.push(path.relative(destDir, themePath));
    }
  }

  // ── Embeddings JSONL ──────────────────────────────────────────────────────
  let embeddingCount = 0;
  if (formats.includes('embeddings')) {
    const embRows = db.prepare('SELECT entry_id, vector, model_name FROM embeddings').all();
    const embeddings = embRows.map((r) => {
      const bytes = new Uint8Array(r.vector);
      return { entry_id: r.entry_id, model_name: r.model_name, vector: new Float32Array(bytes.buffer) };
    });
    write(destDir, 'embeddings.jsonl', embeddingsToJsonl(embeddings));
    embeddingCount = embeddings.length;
    files.push('embeddings.jsonl');
  }

  // ── Vector DB folder ──────────────────────────────────────────────────────
  if (formats.includes('vectorDb')) {
    const srcDir = config.vectorStore.path;
    if (fs.existsSync(srcDir)) {
      const destVecDir = path.join(destDir, 'vectors');
      copyDirRecursive(srcDir, destVecDir);
      files.push('vectors/');
    }
  }

  return {
    files: files.map((f) => (path.isAbsolute(f) ? f : path.join(destDir, f))),
    entryCount: entries.length,
    themeCount: enrichedThemes.length,
    embeddingCount,
  };
}

function write(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src,  entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { runExport };
