'use strict';

/**
 * OneNote export adapter — CCF → OneNote-compatible HTML
 *
 * Satisfies the adapter registry contract (id, name, description, export()).
 *
 * Output structure:
 *   <destDir>/
 *     <theme-slug>/          ← one sub-folder per theme (OneNote section)
 *       _summary.htm         ← section overview page
 *       <entry-id>.htm       ← one page per entry, chronological
 *     _unthemed/             ← entries not belonging to any theme
 *       <entry-id>.htm
 *
 * Files use the OneNote HTML schema so they can be dragged into OneNote
 * or imported via File → Open.
 *
 * @see https://learn.microsoft.com/en-us/graph/integrate-with-onenote
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
    .slice(0, 64) || 'unnamed';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── HTML page builders ────────────────────────────────────────────────────────

function buildEntryPage(entry) {
  const title   = `Entry — ${fmtDate(entry.created_at)}`;
  const tags    = (entry.tags || []).join(', ') || '—';
  const domain  = entry.domain || '—';
  const updated = entry.updated_at ? fmtDate(entry.updated_at) : '—';
  const body    = escapeHtml(entry.text || '').replace(/\n/g, '<br />');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="Microsoft.Office.Document.Type" content="Microsoft OneNote Page" />
  <title>${escapeHtml(title)}</title>
</head>
<body data-absolute-enabled="true">
  <h1>${escapeHtml(title)}</h1>
  <table style="font-size:11pt;color:#555;width:100%;margin-bottom:16px">
    <tr><td><strong>Created</strong></td><td>${escapeHtml(fmtDate(entry.created_at))}</td></tr>
    <tr><td><strong>Updated</strong></td><td>${escapeHtml(updated)}</td></tr>
    <tr><td><strong>Domain</strong></td><td>${escapeHtml(domain)}</td></tr>
    <tr><td><strong>Tags</strong></td><td>${escapeHtml(tags)}</td></tr>
  </table>
  <div style="font-size:13pt;line-height:1.6">${body}</div>
</body>
</html>`;
}

function buildSummaryPage(theme) {
  const name    = escapeHtml(theme.name || 'Unnamed Theme');
  const summary = escapeHtml(theme.summary || theme.description || '').replace(/\n/g, '<br />');
  const count   = (theme.entry_ids || []).length;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="Microsoft.Office.Document.Type" content="Microsoft OneNote Page" />
  <title>${name}</title>
</head>
<body data-absolute-enabled="true">
  <h1>${name}</h1>
  <p style="font-size:11pt;color:#555">${count} entries</p>
  <div style="font-size:13pt;line-height:1.6">${summary || '<em>No summary available.</em>'}</div>
</body>
</html>`;
}

// ── adapter ───────────────────────────────────────────────────────────────────

module.exports = {
  id:          'onenote',
  name:        'OneNote',
  description: 'OneNote-compatible HTML files — one section per theme, one page per entry',

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

    // ── themed sections ─────────────────────────────────────────────────────
    for (const theme of themes) {
      const sectionDir = path.join(destDir, slugify(theme.name));
      fs.mkdirSync(sectionDir, { recursive: true });

      const summaryPath = path.join(sectionDir, '_summary.htm');
      fs.writeFileSync(summaryPath, buildSummaryPage(theme), 'utf8');
      files.push(summaryPath);

      const memberIds = (theme.entry_ids || []).slice()
        .sort((a, b) => (entryMap.get(a)?.created_at || '').localeCompare(entryMap.get(b)?.created_at || ''));

      for (const eid of memberIds) {
        const entry = entryMap.get(eid);
        if (!entry) continue;
        const pagePath = path.join(sectionDir, `${eid}.htm`);
        fs.writeFileSync(pagePath, buildEntryPage(entry), 'utf8');
        files.push(pagePath);
      }
    }

    // ── unthemed entries ─────────────────────────────────────────────────────
    const unthemed = entries
      .filter((e) => !themedIds.has(e.id))
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    if (unthemed.length > 0) {
      const unthemedDir = path.join(destDir, '_unthemed');
      fs.mkdirSync(unthemedDir, { recursive: true });
      for (const entry of unthemed) {
        const pagePath = path.join(unthemedDir, `${entry.id}.htm`);
        fs.writeFileSync(pagePath, buildEntryPage(entry), 'utf8');
        files.push(pagePath);
      }
    }

    return { files, entryCount: entries.length, themeCount: themes.length };
  },
};
