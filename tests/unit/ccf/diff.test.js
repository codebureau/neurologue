'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const { diffCCF } = require('../../../src/backend/ccf/diff');

// ── snapshot fixture builder ──────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-ccf-diff-'));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSnapshot(name, { entries = [], themes = [] } = {}) {
  const dir = path.join(tmpDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'entries.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n'), 'utf8');
  fs.writeFileSync(path.join(dir, 'themes.json'),
    JSON.stringify(themes, null, 2), 'utf8');
  return dir;
}

function entry(id, updatedAt = '2026-01-01T00:00:00Z', extra = {}) {
  return { id, created_at: '2026-01-01T00:00:00Z', updated_at: updatedAt, text: `Entry ${id}`, tags: [], theme_ids: [], media_refs: [], metadata: {}, ...extra };
}

function theme(id, entryIds = [], extra = {}) {
  return { id, name: `Theme ${id}`, summary: '', entry_ids: entryIds, metrics: {}, metadata: {}, ...extra };
}

// ── identical snapshots ───────────────────────────────────────────────────────

describe('identical snapshots', () => {
  test('returns empty diff for two identical snapshots', () => {
    const entries = [entry('e1'), entry('e2')];
    const themes  = [theme('t1', ['e1', 'e2'])];
    const old = makeSnapshot('old', { entries, themes });
    const nw  = makeSnapshot('new', { entries, themes });
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries).toHaveLength(0);
    expect(diff.updatedEntries).toHaveLength(0);
    expect(diff.deletedEntries).toHaveLength(0);
    expect(diff.themeChanges).toHaveLength(0);
  });
});

// ── addedEntries ─────────────────────────────────────────────────────────────

describe('addedEntries', () => {
  test('detects entries present in new but absent in old', () => {
    const old = makeSnapshot('old', { entries: [entry('e1')] });
    const nw  = makeSnapshot('new', { entries: [entry('e1'), entry('e2'), entry('e3')] });
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries.map((e) => e.id).sort()).toEqual(['e2', 'e3']);
  });

  test('addedEntries are sorted by id for determinism', () => {
    const old = makeSnapshot('old', { entries: [] });
    const nw  = makeSnapshot('new', { entries: [entry('e3'), entry('e1'), entry('e2')] });
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  test('addedEntries contains the full entry object', () => {
    const old = makeSnapshot('old', { entries: [] });
    const nw  = makeSnapshot('new', { entries: [entry('e1', '2026-03-01T00:00:00Z', { text: 'hello' })] });
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries[0].text).toBe('hello');
  });
});

// ── updatedEntries ────────────────────────────────────────────────────────────

describe('updatedEntries', () => {
  test('detects entries with changed updated_at', () => {
    const old = makeSnapshot('old', { entries: [entry('e1', '2026-01-01T00:00:00Z')] });
    const nw  = makeSnapshot('new', { entries: [entry('e1', '2026-06-01T00:00:00Z')] });
    const diff = diffCCF(old, nw);
    expect(diff.updatedEntries).toHaveLength(1);
    expect(diff.updatedEntries[0].id).toBe('e1');
  });

  test('updatedEntries contains before and after', () => {
    const oldEntry = entry('e1', '2026-01-01T00:00:00Z', { text: 'old text' });
    const newEntry = entry('e1', '2026-06-01T00:00:00Z', { text: 'new text' });
    const old = makeSnapshot('old', { entries: [oldEntry] });
    const nw  = makeSnapshot('new', { entries: [newEntry] });
    const diff = diffCCF(old, nw);
    expect(diff.updatedEntries[0].before.text).toBe('old text');
    expect(diff.updatedEntries[0].after.text).toBe('new text');
  });

  test('does not flag entries with identical updated_at as updated', () => {
    const e = entry('e1', '2026-01-01T00:00:00Z');
    const old = makeSnapshot('old', { entries: [e] });
    const nw  = makeSnapshot('new', { entries: [e] });
    const diff = diffCCF(old, nw);
    expect(diff.updatedEntries).toHaveLength(0);
  });

  test('updatedEntries are sorted by id for determinism', () => {
    const old = makeSnapshot('old', { entries: [entry('ec', '2026-01-01T00:00:00Z'), entry('ea', '2026-01-01T00:00:00Z')] });
    const nw  = makeSnapshot('new', { entries: [entry('ec', '2026-06-01T00:00:00Z'), entry('ea', '2026-06-01T00:00:00Z')] });
    const diff = diffCCF(old, nw);
    expect(diff.updatedEntries.map((u) => u.id)).toEqual(['ea', 'ec']);
  });
});

// ── deletedEntries ────────────────────────────────────────────────────────────

describe('deletedEntries', () => {
  test('detects entries present in old but absent in new', () => {
    const old = makeSnapshot('old', { entries: [entry('e1'), entry('e2')] });
    const nw  = makeSnapshot('new', { entries: [entry('e1')] });
    const diff = diffCCF(old, nw);
    expect(diff.deletedEntries).toHaveLength(1);
    expect(diff.deletedEntries[0].id).toBe('e2');
  });

  test('deletedEntries contains the original entry object', () => {
    const old = makeSnapshot('old', { entries: [entry('e1', '2026-01-01T00:00:00Z', { text: 'gone' })] });
    const nw  = makeSnapshot('new', { entries: [] });
    const diff = diffCCF(old, nw);
    expect(diff.deletedEntries[0].entry.text).toBe('gone');
  });

  test('deletedEntries are sorted by id for determinism', () => {
    const old = makeSnapshot('old', { entries: [entry('ez'), entry('ea'), entry('em')] });
    const nw  = makeSnapshot('new', { entries: [] });
    const diff = diffCCF(old, nw);
    expect(diff.deletedEntries.map((d) => d.id)).toEqual(['ea', 'em', 'ez']);
  });
});

// ── themeChanges — added ──────────────────────────────────────────────────────

describe('themeChanges — added themes', () => {
  test('detects themes present in new but absent in old', () => {
    const old = makeSnapshot('old', { themes: [] });
    const nw  = makeSnapshot('new', { themes: [theme('t1', ['e1'])] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges).toHaveLength(1);
    expect(diff.themeChanges[0].status).toBe('added');
    expect(diff.themeChanges[0].id).toBe('t1');
  });

  test('added theme includes all its entry IDs as addedEntryIds', () => {
    const old = makeSnapshot('old', { themes: [] });
    const nw  = makeSnapshot('new', { themes: [theme('t1', ['e2', 'e1', 'e3'])] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges[0].addedEntryIds).toEqual(['e1', 'e2', 'e3']); // sorted
    expect(diff.themeChanges[0].removedEntryIds).toEqual([]);
  });
});

// ── themeChanges — removed ────────────────────────────────────────────────────

describe('themeChanges — removed themes', () => {
  test('detects themes present in old but absent in new', () => {
    const old = makeSnapshot('old', { themes: [theme('t1', ['e1'])] });
    const nw  = makeSnapshot('new', { themes: [] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges).toHaveLength(1);
    expect(diff.themeChanges[0].status).toBe('removed');
    expect(diff.themeChanges[0].id).toBe('t1');
  });

  test('removed theme includes all its entry IDs as removedEntryIds', () => {
    const old = makeSnapshot('old', { themes: [theme('t1', ['e2', 'e1'])] });
    const nw  = makeSnapshot('new', { themes: [] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges[0].removedEntryIds).toEqual(['e1', 'e2']);
    expect(diff.themeChanges[0].addedEntryIds).toEqual([]);
  });
});

// ── themeChanges — modified ───────────────────────────────────────────────────

describe('themeChanges — modified themes', () => {
  test('detects membership changes in an existing theme', () => {
    const old = makeSnapshot('old', { themes: [theme('t1', ['e1', 'e2'])] });
    const nw  = makeSnapshot('new', { themes: [theme('t1', ['e1', 'e3'])] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges).toHaveLength(1);
    expect(diff.themeChanges[0].status).toBe('modified');
    expect(diff.themeChanges[0].addedEntryIds).toEqual(['e3']);
    expect(diff.themeChanges[0].removedEntryIds).toEqual(['e2']);
  });

  test('does not flag theme as modified when membership is identical', () => {
    const t = theme('t1', ['e1', 'e2']);
    const old = makeSnapshot('old', { themes: [t] });
    const nw  = makeSnapshot('new', { themes: [t] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges).toHaveLength(0);
  });

  test('themeChanges are sorted by id for determinism', () => {
    const old = makeSnapshot('old', { themes: [theme('tc', ['e1']), theme('ta', ['e1'])] });
    const nw  = makeSnapshot('new', { themes: [theme('tc', ['e1', 'e2']), theme('ta', ['e1', 'e2'])] });
    const diff = diffCCF(old, nw);
    expect(diff.themeChanges.map((c) => c.id)).toEqual(['ta', 'tc']);
  });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('handles empty old and new snapshots', () => {
    const old = makeSnapshot('old');
    const nw  = makeSnapshot('new');
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries).toHaveLength(0);
    expect(diff.updatedEntries).toHaveLength(0);
    expect(diff.deletedEntries).toHaveLength(0);
    expect(diff.themeChanges).toHaveLength(0);
  });

  test('handles missing themes.json gracefully', () => {
    const old = makeSnapshot('old', { entries: [entry('e1')] });
    const nw  = makeSnapshot('new', { entries: [entry('e1'), entry('e2')] });
    // Remove themes.json from both
    fs.unlinkSync(path.join(old, 'themes.json'));
    fs.unlinkSync(path.join(nw, 'themes.json'));
    expect(() => diffCCF(old, nw)).not.toThrow();
  });

  test('correctly handles large symmetric diff', () => {
    const oldEntries = Array.from({ length: 50 }, (_, i) => entry(`e${String(i).padStart(3, '0')}`));
    const newEntries = Array.from({ length: 50 }, (_, i) => entry(`e${String(i + 50).padStart(3, '0')}`));
    const old = makeSnapshot('old', { entries: oldEntries });
    const nw  = makeSnapshot('new', { entries: newEntries });
    const diff = diffCCF(old, nw);
    expect(diff.addedEntries).toHaveLength(50);
    expect(diff.deletedEntries).toHaveLength(50);
    expect(diff.updatedEntries).toHaveLength(0);
  });
});
