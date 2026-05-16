'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeEntry(id, text, tags = []) {
  return { id, created_at: `2026-01-0${id.slice(-1)}T10:00:00.000Z`, text, domain: 'work', tags };
}

/** Generate a long entry whose text exceeds CHUNK_WORDS (500) alone. */
function longText(words = 600) {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
}

const ENTRIES_SHORT = [
  makeEntry('e1', 'Short entry one',   ['tag-a']),
  makeEntry('e2', 'Short entry two',   []),
  makeEntry('e3', 'Unthemed entry',    []),
];

const THEMES = [
  { id: 't1', name: 'Quick Ideas', summary: 'Brief theme summary', entry_ids: ['e1', 'e2'] },
];

function writeCcfSnapshot(dir, { entries = ENTRIES_SHORT, themes = THEMES } = {}) {
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
  tmpDir      = fs.mkdtempSync(path.join(os.tmpdir(), 'nrlg-copilot-'));
  snapshotDir = path.join(tmpDir, 'snapshot');
  outDir      = path.join(tmpDir, 'out');
  writeCcfSnapshot(snapshotDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── tests ─────────────────────────────────────────────────────────────────────

const adapter = require('../../../src/backend/export/copilot');

describe('Copilot adapter — registry contract', () => {
  test('exposes id, name, description, export', () => {
    expect(typeof adapter.id).toBe('string');
    expect(typeof adapter.name).toBe('string');
    expect(typeof adapter.description).toBe('string');
    expect(typeof adapter.export).toBe('function');
    expect(adapter.id).toBe('copilot');
  });
});

describe('Copilot adapter — export()', () => {
  test('creates output directory', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(outDir)).toBe(true);
  });

  test('returns expected counts', () => {
    const result = adapter.export(snapshotDir, outDir);
    expect(result.entryCount).toBe(3);
    expect(result.themeCount).toBe(1);
  });

  test('writes a theme file with deterministic slug', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'quick-ideas.md'))).toBe(true);
  });

  test('theme file contains H1 heading and summary', () => {
    adapter.export(snapshotDir, outDir);
    const md = fs.readFileSync(path.join(outDir, 'quick-ideas.md'), 'utf8');
    expect(md).toContain('# Quick Ideas');
    expect(md).toContain('Brief theme summary');
  });

  test('theme file contains H2 per entry', () => {
    adapter.export(snapshotDir, outDir);
    const md = fs.readFileSync(path.join(outDir, 'quick-ideas.md'), 'utf8');
    expect(md).toContain('## Entry 1');
    expect(md).toContain('## Entry 2');
  });

  test('writes uncategorized.md for unthemed entries', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'uncategorized.md'))).toBe(true);
    const md = fs.readFileSync(path.join(outDir, 'uncategorized.md'), 'utf8');
    expect(md).toContain('Unthemed entry');
  });

  test('writes index.md listing all files', () => {
    adapter.export(snapshotDir, outDir);
    expect(fs.existsSync(path.join(outDir, 'index.md'))).toBe(true);
    const md = fs.readFileSync(path.join(outDir, 'index.md'), 'utf8');
    expect(md).toContain('quick-ideas.md');
    expect(md).toContain('uncategorized.md');
  });

  test('writes metadata.json with correct fields', () => {
    adapter.export(snapshotDir, outDir);
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'metadata.json'), 'utf8'));
    expect(meta.adapter).toBe('copilot');
    expect(meta.entryCount).toBe(3);
    expect(meta.themeCount).toBe(1);
    expect(typeof meta.chunkWords).toBe('number');
    expect(typeof meta.exportedAt).toBe('string');
  });

  test('long entries are split into numbered chunk files', () => {
    const entries = [
      { id: 'e1', created_at: '2026-01-01T00:00:00.000Z', text: longText(600), tags: [] },
      { id: 'e2', created_at: '2026-01-02T00:00:00.000Z', text: longText(600), tags: [] },
    ];
    const themes = [{ id: 't1', name: 'Big Topic', entry_ids: ['e1', 'e2'] }];
    writeCcfSnapshot(snapshotDir, { entries, themes });
    adapter.export(snapshotDir, outDir);
    // Two 600-word entries exceed the 500-word chunk limit, so should split into 2 chunks
    expect(fs.existsSync(path.join(outDir, 'big-topic-1.md'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'big-topic-2.md'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'big-topic.md'))).toBe(false);
  });

  test('chunk files are mentioned in index.md', () => {
    const entries = [
      { id: 'e1', created_at: '2026-01-01T00:00:00.000Z', text: longText(600), tags: [] },
      { id: 'e2', created_at: '2026-01-02T00:00:00.000Z', text: longText(600), tags: [] },
    ];
    const themes = [{ id: 't1', name: 'Big Topic', entry_ids: ['e1', 'e2'] }];
    writeCcfSnapshot(snapshotDir, { entries, themes });
    adapter.export(snapshotDir, outDir);
    const index = fs.readFileSync(path.join(outDir, 'index.md'), 'utf8');
    expect(index).toContain('big-topic-1.md');
    expect(index).toContain('big-topic-2.md');
  });

  test('handles empty corpus gracefully', () => {
    writeCcfSnapshot(snapshotDir, { entries: [], themes: [] });
    const result = adapter.export(snapshotDir, outDir);
    expect(result.entryCount).toBe(0);
    expect(result.themeCount).toBe(0);
    expect(fs.existsSync(path.join(outDir, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'metadata.json'))).toBe(true);
  });

  test('files array lists all written files', () => {
    const result = adapter.export(snapshotDir, outDir);
    for (const f of result.files) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });
});

describe('Copilot adapter — registry', () => {
  test('getAdapter("copilot") returns the copilot adapter', () => {
    const { getAdapter, listAdapters } = require('../../../src/backend/export/adapters/registry');
    const found = getAdapter('copilot');
    expect(found).toBeTruthy();
    expect(found.id).toBe('copilot');

    const all = listAdapters();
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.map((a) => a.id)).toContain('onenote');
    expect(all.map((a) => a.id)).toContain('notebooklm');
    expect(all.map((a) => a.id)).toContain('copilot');
  });

  test('getAdapter returns null for unknown id', () => {
    const { getAdapter } = require('../../../src/backend/export/adapters/registry');
    expect(getAdapter('nonexistent')).toBeNull();
  });
});
