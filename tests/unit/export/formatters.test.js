'use strict';

const {
  entriesToJson,
  themesToJson,
  entriesToMarkdown,
  themesToMarkdown,
  embeddingsToJsonl,
} = require('../../../src/backend/export/formatters');

// ── Test data ──────────────────────────────────────────────────────────────

const ENTRIES = [
  {
    id: 'e1',
    content: 'The quick brown fox',
    source: 'manual',
    type: 'note',
    created_at: '2026-01-15 10:00:00',
    tags: [{ id: 't1', name: 'ideas' }, { id: 't2', name: 'test' }],
  },
  {
    id: 'e2',
    content: 'Another thought here',
    source: 'clipboard',
    type: 'note',
    created_at: '2026-01-16 11:30:00',
    tags: [],
  },
];

const THEMES = [
  {
    id: 'th1',
    name: 'Theme 1',
    description: 'Notes about quick things',
    entries: [
      { entry_id: 'e1', score: 0.95 },
      { entry_id: 'e2', score: 0.72 },
    ],
  },
  {
    id: 'th2',
    name: 'Theme 2',
    description: '',
    entries: [],
  },
];

const EMBEDDINGS = [
  { entry_id: 'e1', model_name: 'bge-small-en', vector: new Float32Array([0.1, 0.2, 0.3]) },
  { entry_id: 'e2', model_name: 'bge-small-en', vector: new Float32Array([0.4, 0.5, 0.6]) },
];

// ── entriesToJson ──────────────────────────────────────────────────────────

describe('entriesToJson', () => {
  test('produces valid JSON array', () => {
    const json = entriesToJson(ENTRIES);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  test('includes expected fields', () => {
    const parsed = JSON.parse(entriesToJson(ENTRIES));
    const e = parsed[0];
    expect(e).toHaveProperty('id', 'e1');
    expect(e).toHaveProperty('content', 'The quick brown fox');
    expect(e).toHaveProperty('source', 'manual');
    expect(e).toHaveProperty('created_at');
    expect(e.tags).toEqual(['ideas', 'test']);
  });

  test('handles entry with no tags', () => {
    const parsed = JSON.parse(entriesToJson(ENTRIES));
    expect(parsed[1].tags).toEqual([]);
  });

  test('handles empty array', () => {
    const parsed = JSON.parse(entriesToJson([]));
    expect(parsed).toEqual([]);
  });
});

// ── themesToJson ───────────────────────────────────────────────────────────

describe('themesToJson', () => {
  test('produces valid JSON array', () => {
    const parsed = JSON.parse(themesToJson(THEMES));
    expect(parsed).toHaveLength(2);
  });

  test('includes id, name, summary, entries', () => {
    const parsed = JSON.parse(themesToJson(THEMES));
    const t = parsed[0];
    expect(t).toHaveProperty('id', 'th1');
    expect(t).toHaveProperty('name', 'Theme 1');
    expect(t).toHaveProperty('summary', 'Notes about quick things');
    expect(t.entries).toHaveLength(2);
    expect(t.entries[0]).toHaveProperty('score', 0.95);
  });

  test('empty description becomes empty string summary', () => {
    const parsed = JSON.parse(themesToJson(THEMES));
    expect(parsed[1].summary).toBe('');
  });

  test('handles empty array', () => {
    expect(JSON.parse(themesToJson([]))).toEqual([]);
  });
});

// ── entriesToMarkdown ──────────────────────────────────────────────────────

describe('entriesToMarkdown', () => {
  test('produces a non-empty string', () => {
    const md = entriesToMarkdown(ENTRIES);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });

  test('contains entry content', () => {
    const md = entriesToMarkdown(ENTRIES);
    expect(md).toContain('The quick brown fox');
    expect(md).toContain('Another thought here');
  });

  test('contains tag names', () => {
    const md = entriesToMarkdown(ENTRIES);
    expect(md).toContain('`ideas`');
    expect(md).toContain('`test`');
  });

  test('includes H1 heading', () => {
    const md = entriesToMarkdown(ENTRIES);
    expect(md).toMatch(/^# Neurologue Export/);
  });

  test('handles empty array', () => {
    const md = entriesToMarkdown([]);
    expect(md).toContain('# Neurologue Export');
  });
});

// ── themesToMarkdown ───────────────────────────────────────────────────────

describe('themesToMarkdown', () => {
  test('contains theme names as H2 headings', () => {
    const md = themesToMarkdown(THEMES);
    expect(md).toContain('## Theme 1');
    expect(md).toContain('## Theme 2');
  });

  test('includes summary blockquote when present', () => {
    const md = themesToMarkdown(THEMES);
    expect(md).toContain('> Notes about quick things');
  });
});

// ── embeddingsToJsonl ──────────────────────────────────────────────────────

describe('embeddingsToJsonl', () => {
  test('produces one JSON object per line', () => {
    const jsonl = embeddingsToJsonl(EMBEDDINGS);
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    lines.forEach((line) => expect(() => JSON.parse(line)).not.toThrow());
  });

  test('each line has entry_id, model_name, vector', () => {
    const lines = embeddingsToJsonl(EMBEDDINGS).split('\n').filter(Boolean);
    const obj = JSON.parse(lines[0]);
    expect(obj).toHaveProperty('entry_id', 'e1');
    expect(obj).toHaveProperty('model_name', 'bge-small-en');
    expect(Array.isArray(obj.vector)).toBe(true);
    expect(obj.vector).toHaveLength(3);
  });

  test('vector values are numbers', () => {
    const lines = embeddingsToJsonl(EMBEDDINGS).split('\n').filter(Boolean);
    const obj = JSON.parse(lines[0]);
    obj.vector.forEach((v) => expect(typeof v).toBe('number'));
  });

  test('handles empty array', () => {
    expect(embeddingsToJsonl([])).toBe('');
  });
});
