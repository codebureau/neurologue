'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-ccf-validate-'));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Fixture builder ──────────────────────────────────────────────────────────

/**
 * Write a minimal valid CCF snapshot into a folder.
 * Accepts overrides for each file so individual tests can break things.
 */
function writeSnapshot(dir, {
  entriesJsonl  = defaultEntriesJsonl(),
  themesJson    = defaultThemesJson(),
  metadataJson  = defaultMetadataJson(),
  withEmbeddings = true,
} = {}) {
  fs.mkdirSync(path.join(dir, 'embeddings'), { recursive: true });
  if (entriesJsonl  !== null) fs.writeFileSync(path.join(dir, 'entries.jsonl'),  entriesJsonl,  'utf8');
  if (themesJson    !== null) fs.writeFileSync(path.join(dir, 'themes.json'),    themesJson,    'utf8');
  if (metadataJson  !== null) fs.writeFileSync(path.join(dir, 'metadata.json'),  metadataJson,  'utf8');
  if (withEmbeddings) {
    const emb = [
      JSON.stringify({ entry_id: 'e1', model: 'test-model', vector: [0.1, 0.2, 0.3] }),
      JSON.stringify({ entry_id: 'e2', model: 'test-model', vector: [0.4, 0.5, 0.6] }),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'embeddings', 'entries.jsonl'), emb, 'utf8');
  }
}

function defaultEntriesJsonl() {
  return [
    JSON.stringify({ id: 'e1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', text: 'First', source: { type: 'user', app: 'neurologue', external_id: null }, domain: 'personal', tags: [], theme_ids: ['t1'], media_refs: [], metadata: {} }),
    JSON.stringify({ id: 'e2', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', text: 'Second', source: { type: 'user', app: 'neurologue', external_id: null }, domain: 'personal', tags: ['ideas'], theme_ids: [], media_refs: [], metadata: {} }),
  ].join('\n');
}

function defaultThemesJson() {
  return JSON.stringify([
    { id: 't1', name: 'Theme One', summary: 'A theme', entry_ids: ['e1'], metrics: { entry_count: 1 }, metadata: {} },
  ], null, 2);
}

function defaultMetadataJson() {
  return JSON.stringify({
    format_version: '1.0.0',
    exported_at:    '2026-01-10T12:00:00.000Z',
    app:   { name: 'Neurologue', version: '0.5.0' },
    embedding: { model: 'test-model', dimension: 3 },
    notes: { entry_count: 2, theme_count: 1 },
    custom: {},
  }, null, 2);
}

// ── Valid snapshot baseline ──────────────────────────────────────────────────

describe('validateCCF — valid snapshot', () => {
  test('returns ok:true and no errors for a well-formed snapshot', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir);
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('returns ok:true when embeddings folder is absent', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('returns ok:true for an empty corpus (no entries, no themes)', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, {
      entriesJsonl: '',
      themesJson:   '[]',
      withEmbeddings: false,
    });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// ── Check 1: Required files ──────────────────────────────────────────────────

describe('validateCCF — required files', () => {
  test('reports error when entries.jsonl is missing', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { entriesJsonl: null });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('entries.jsonl'))).toBe(true);
  });

  test('reports error when themes.json is missing', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { themesJson: null });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('themes.json'))).toBe(true);
  });

  test('reports error when metadata.json is missing', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { metadataJson: null });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('metadata.json'))).toBe(true);
  });

  test('reports all missing files in one pass', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { entriesJsonl: null, themesJson: null, metadataJson: null });
    const result = validateCCF(tmpDir);
    expect(result.errors.length).toBe(3);
  });
});

// ── Check 2: JSON parsing ────────────────────────────────────────────────────

describe('validateCCF — JSON parsing', () => {
  test('reports error for invalid JSON in metadata.json', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { metadataJson: '{ broken json' });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('metadata.json'))).toBe(true);
  });

  test('reports error for invalid JSON in themes.json', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { themesJson: '[ { broken }' });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('themes.json'))).toBe(true);
  });

  test('reports error when themes.json is not an array', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { themesJson: '{ "id": "t1" }' });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('array'))).toBe(true);
  });

  test('reports error for an invalid JSONL line in entries.jsonl', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const bad = 'not json at all\n' + JSON.stringify({ id: 'e2', text: 'ok', media_refs: [] });
    writeSnapshot(tmpDir, { entriesJsonl: bad, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('entries.jsonl line 1'))).toBe(true);
  });

  test('blank lines in entries.jsonl are ignored', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const withBlanks = '\n' + defaultEntriesJsonl() + '\n\n';
    writeSnapshot(tmpDir, { entriesJsonl: withBlanks });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
  });
});

// ── Check 3: Entry ID uniqueness ─────────────────────────────────────────────

describe('validateCCF — entry ID uniqueness', () => {
  test('reports error for duplicate entry ids', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const entry = JSON.stringify({ id: 'e1', text: 'dup', media_refs: [] });
    writeSnapshot(tmpDir, { entriesJsonl: entry + '\n' + entry, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate entry id') && e.includes('e1'))).toBe(true);
  });

  test('reports error for entry missing id field', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const noId = JSON.stringify({ text: 'no id here', media_refs: [] });
    writeSnapshot(tmpDir, { entriesJsonl: noId, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('missing required field "id"'))).toBe(true);
  });
});

// ── Check 4: Theme ID uniqueness ─────────────────────────────────────────────

describe('validateCCF — theme ID uniqueness', () => {
  test('reports error for duplicate theme ids', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const dupThemes = JSON.stringify([
      { id: 't1', name: 'A', entry_ids: [] },
      { id: 't1', name: 'B', entry_ids: [] },
    ]);
    writeSnapshot(tmpDir, { themesJson: dupThemes, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('duplicate theme id') && e.includes('t1'))).toBe(true);
  });

  test('reports error for theme missing id field', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const noId = JSON.stringify([{ name: 'No id', entry_ids: [] }]);
    writeSnapshot(tmpDir, { themesJson: noId, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('missing required field "id"'))).toBe(true);
  });
});

// ── Check 5: Media file references ──────────────────────────────────────────

describe('validateCCF — media file references', () => {
  test('reports error when a referenced media file does not exist', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const entry = JSON.stringify({
      id: 'e1', text: 'has media', media_refs: [{ path: 'media/image.png', type: 'image' }],
    });
    writeSnapshot(tmpDir, { entriesJsonl: entry, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('media/image.png'))).toBe(true);
  });

  test('passes when a referenced media file exists on disk', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    fs.mkdirSync(path.join(tmpDir, 'media'));
    fs.writeFileSync(path.join(tmpDir, 'media', 'image.png'), 'fake', 'utf8');
    const entry = JSON.stringify({
      id: 'e1', text: 'has media', media_refs: [{ path: 'media/image.png', type: 'image' }],
    });
    writeSnapshot(tmpDir, { entriesJsonl: entry, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
  });

  test('reports error when media_ref is missing path field', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    const entry = JSON.stringify({
      id: 'e1', text: 'bad ref', media_refs: [{ type: 'image' }],
    });
    writeSnapshot(tmpDir, { entriesJsonl: entry, withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"path" field'))).toBe(true);
  });
});

// ── Check 6: Embedding existence ─────────────────────────────────────────────

describe('validateCCF — embedding existence', () => {
  test('reports error when an entry has no embedding', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    // entries.jsonl has e1 and e2, embeddings only has e1
    writeSnapshot(tmpDir);
    const embOnly1 = JSON.stringify({ entry_id: 'e1', model: 'test', vector: [0.1] });
    fs.writeFileSync(path.join(tmpDir, 'embeddings', 'entries.jsonl'), embOnly1, 'utf8');
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('"e2"') && e.includes('no embedding'))).toBe(true);
  });

  test('passes when embeddings folder is absent (optional)', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir, { withEmbeddings: false });
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(true);
  });

  test('reports error for invalid JSON in embeddings/entries.jsonl', () => {
    const { validateCCF } = require('../../../src/backend/ccf/validate');
    writeSnapshot(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'embeddings', 'entries.jsonl'), 'not json', 'utf8');
    const result = validateCCF(tmpDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('embeddings/entries.jsonl'))).toBe(true);
  });
});

// ── Check 7: metadata.json required fields ───────────────────────────────────

describe('validateCCF — metadata required fields', () => {
  test.each(['format_version', 'exported_at', 'app', 'notes'])(
    'reports error when "%s" is missing from metadata.json',
    (field) => {
      const { validateCCF } = require('../../../src/backend/ccf/validate');
      const meta = JSON.parse(defaultMetadataJson());
      delete meta[field];
      writeSnapshot(tmpDir, { metadataJson: JSON.stringify(meta), withEmbeddings: false });
      const result = validateCCF(tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes(`"${field}"`))).toBe(true);
    },
  );
});
