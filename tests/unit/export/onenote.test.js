'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── fixtures ──────────────────────────────────────────────────────────────────

const ENTRIES = [
  { id: 'e1', created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-01-02T10:00:00.000Z', text: 'First entry content', domain: 'work', tags: ['tag-a', 'tag-b'] },
  { id: 'e2', created_at: '2026-01-03T10:00:00.000Z', updated_at: null,                        text: 'Second entry content', domain: 'personal', tags: [] },
  { id: 'e3', created_at: '2026-01-05T10:00:00.000Z', updated_at: null,                        text: 'Unthemed entry',       domain: null,       tags: [] },
];

const THEMES = [
  { id: 't1', name: 'Alpha Theme', summary: 'A summary of alpha', entry_ids: ['e1', 'e2'] },
];

function writeCcfSnapshot(dir, { entries = ENTRIES, themes = THEMES } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'entries.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'themes.json'),
    JSON.stringify(themes),
    'utf8',
  );
}

// ── setup / teardown ──────────────────────────────────────────────────────────

let tmpDir, snapshotDir, outDir;

beforeEach(() => {
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'nrlg-onenote-'));
  snapshotDir = path.join(tmpDir, 'snapshot');
  outDir      = path.join(tmpDir, 'out');
  writeCcfSnapshot(snapshotDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

const { export: exportOneNote } = require('../../../src/backend/export/onenote');

describe('OneNote adapter — registry contract', () => {
  test('exposes id, name, description, export', () => {
    const adapter = require('../../../src/backend/export/onenote');
    expect(typeof adapter.id).toBe('string');
    expect(typeof adapter.name).toBe('string');
    expect(typeof adapter.description).toBe('string');
    expect(typeof adapter.export).toBe('function');
    expect(adapter.id).toBe('onenote');
  });
});

describe('OneNote adapter — export()', () => {
  test('creates output directory', () => {
    exportOneNote(snapshotDir, outDir);
    expect(fs.existsSync(outDir)).toBe(true);
  });

  test('returns expected counts', () => {
    const result = exportOneNote(snapshotDir, outDir);
    expect(result.entryCount).toBe(3);
    expect(result.themeCount).toBe(1);
  });

  test('creates a sub-folder for the theme', () => {
    exportOneNote(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'alpha-theme'))).toBe(true);
  });

  test('writes a _summary.htm for each theme', () => {
    exportOneNote(snapshotDir, outDir);
    const summary = path.join(outDir, 'alpha-theme', '_summary.htm');
    expect(fs.existsSync(summary)).toBe(true);
    const html = fs.readFileSync(summary, 'utf8');
    expect(html).toContain('Alpha Theme');
    expect(html).toContain('Microsoft OneNote Page');
  });

  test('writes one .htm per themed entry', () => {
    exportOneNote(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'alpha-theme', 'e1.htm'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'alpha-theme', 'e2.htm'))).toBe(true);
  });

  test('entry page contains entry text and metadata', () => {
    exportOneNote(snapshotDir, outDir);
    const html = fs.readFileSync(path.join(outDir, 'alpha-theme', 'e1.htm'), 'utf8');
    expect(html).toContain('First entry content');
    expect(html).toContain('tag-a');
    expect(html).toContain('work');
  });

  test('writes _unthemed sub-folder for unthemed entries', () => {
    exportOneNote(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, '_unthemed', 'e3.htm'))).toBe(true);
  });

  test('does NOT write _unthemed when all entries are themed', () => {
    const entries = [
      { id: 'e1', created_at: '2026-01-01T10:00:00.000Z', text: 'A', tags: [] },
    ];
    const themes  = [{ id: 't1', name: 'T', entry_ids: ['e1'] }];
    writeCcfSnapshot(snapshotDir, { entries, themes });
    exportOneNote(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, '_unthemed'))).toBe(false);
  });

  test('handles empty corpus gracefully', () => {
    writeCcfSnapshot(snapshotDir, { entries: [], themes: [] });
    const result = exportOneNote(snapshotDir, outDir);
    expect(result.entryCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(result.files).toEqual([]);
  });

  test('handles theme whose entries are not in entries.jsonl', () => {
    const themes = [{ id: 't1', name: 'Ghost Theme', entry_ids: ['missing-id'] }];
    writeCcfSnapshot(snapshotDir, { entries: ENTRIES, themes });
    // Should not throw; ghost entries are skipped
    expect(() => exportOneNote(snapshotDir, outDir)).not.toThrow();
    const summary = path.join(outDir, 'ghost-theme', '_summary.htm');
    expect(fs.existsSync(summary)).toBe(true);
  });

  test('escapes HTML special characters in entry text', () => {
    const entries = [{ id: 'e1', created_at: '2026-01-01T00:00:00.000Z', text: '<script>alert("xss")</script>', tags: [] }];
    writeCcfSnapshot(snapshotDir, { entries, themes: [] });
    exportOneNote(snapshotDir, outDir);
    const html = fs.readFileSync(path.join(outDir, '_unthemed', 'e1.htm'), 'utf8');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('files array lists all written files', () => {
    const result = exportOneNote(snapshotDir, outDir);
    for (const f of result.files) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });
});
