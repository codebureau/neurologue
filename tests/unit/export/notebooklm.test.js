'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── fixtures ──────────────────────────────────────────────────────────────────

const ENTRIES = [
  { id: 'e1', created_at: '2026-01-01T10:00:00.000Z', text: 'First entry',  domain: 'work',     tags: ['alpha'] },
  { id: 'e2', created_at: '2026-01-03T10:00:00.000Z', text: 'Second entry', domain: 'personal', tags: [] },
  { id: 'e3', created_at: '2026-01-05T10:00:00.000Z', text: 'Unthemed',     domain: null,       tags: [] },
];

const THEMES = [
  { id: 't1', name: 'Research Notes', summary: 'A summary', entry_ids: ['e1', 'e2'] },
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
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'nrlg-notebooklm-'));
  snapshotDir = path.join(tmpDir, 'snapshot');
  outDir      = path.join(tmpDir, 'out');
  writeCcfSnapshot(snapshotDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

const adapter = require('../../../src/backend/export/notebooklm');

describe('NotebookLM adapter — registry contract', () => {
  test('exposes id, name, description, export', () => {
    expect(typeof adapter.id).toBe('string');
    expect(typeof adapter.name).toBe('string');
    expect(typeof adapter.description).toBe('string');
    expect(typeof adapter.export).toBe('function');
    expect(adapter.id).toBe('notebooklm');
  });
});

describe('NotebookLM adapter — export()', () => {
  test('creates output directory', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(outDir)).toBe(true);
  });

  test('returns expected counts', () => {
    const result = adapter.export(snapshotDir, outDir);
    expect(result.entryCount).toBe(3);
    expect(result.themeCount).toBe(1);
  });

  test('creates one markdown file per theme with deterministic slug', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'research-notes.md'))).toBe(true);
  });

  test('theme file contains theme name and summary', () => {
    adapter.export(snapshotDir, outDir);
    const md = fs.readFileSync(path.join(outDir, 'research-notes.md'), 'utf8');
    expect(md).toContain('# Research Notes');
    expect(md).toContain('A summary');
  });

  test('theme file contains member entry content', () => {
    adapter.export(snapshotDir, outDir);
    const md = fs.readFileSync(path.join(outDir, 'research-notes.md'), 'utf8');
    expect(md).toContain('First entry');
    expect(md).toContain('Second entry');
  });

  test('theme file lists tags and domain', () => {
    adapter.export(snapshotDir, outDir);
    const md = fs.readFileSync(path.join(outDir, 'research-notes.md'), 'utf8');
    expect(md).toContain('alpha');
    expect(md).toContain('work');
  });

  test('creates uncategorized.md for unthemed entries', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'uncategorized.md'))).toBe(true);
    const md = fs.readFileSync(path.join(outDir, 'uncategorized.md'), 'utf8');
    expect(md).toContain('Unthemed');
  });

  test('does not create uncategorized.md when all entries are themed', () => {
    const entries = [{ id: 'e1', created_at: '2026-01-01T00:00:00.000Z', text: 'A', tags: [] }];
    const themes  = [{ id: 't1', name: 'T', entry_ids: ['e1'] }];
    writeCcfSnapshot(snapshotDir, { entries, themes });
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'uncategorized.md'))).toBe(false);
  });

  test('writes metadata.json with correct fields', () => {
    adapter.export(snapshotDir, outDir);
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf8'));
    expect(meta.adapter).toBe('notebooklm');
    expect(meta.entryCount).toBe(3);
    expect(meta.themeCount).toBe(1);
    expect(typeof meta.exportedAt).toBe('string');
  });

  test('handles empty corpus gracefully', () => {
    writeCcfSnapshot(snapshotDir, { entries: [], themes: [] });
    const result = adapter.export(snapshotDir, outDir);
    expect(result.entryCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(fs.existsSync(path.join(outDir, 'metadata.json'))).toBe(true);
  });

  test('slugifies theme names with special characters', () => {
    const themes = [{ id: 't1', name: 'My Research & Notes!', entry_ids: [] }];
    writeCcfSnapshot(snapshotDir, { entries: [], themes });
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'my-research-notes.md'))).toBe(true);
  });

  test('files array lists all written files', () => {
    const result = adapter.export(snapshotDir, outDir);
    for (const f of result.files) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });
});
