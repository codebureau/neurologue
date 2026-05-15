'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { randomUUID } = require('crypto');

let tmpDir;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-graph-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;
  jest.resetModules();
  const { runMigrations } = require('../../../src/db/migrate');
  await runMigrations();
});

afterEach(() => {
  try {
    const { closeDb } = require('../../../src/backend/db/connection');
    closeDb();
  } catch { /* not loaded */ }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.NEUROLOGUE_DATA_PATH;
});

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedEntry(content = 'Test entry') {
  const { createEntry } = require('../../../src/backend/db/entries');
  return createEntry({ content });
}

async function seedTheme(name = 'Test Theme') {
  const { openDb } = require('../../../src/backend/db/connection');
  const db  = await openDb();
  const id  = randomUUID();
  db.prepare('INSERT INTO themes (id, name) VALUES (?, ?)').run(id, name);
  return id;
}

async function linkEntryToTheme(entryId, themeId, score = 0.9) {
  const { openDb } = require('../../../src/backend/db/connection');
  const db = await openDb();
  db.prepare(
    'INSERT INTO theme_entries (theme_id, entry_id, score) VALUES (?, ?, ?)'
  ).run(themeId, entryId, score);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getGraphData', () => {
  test('returns empty nodes and edges for an empty database', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const { nodes, edges } = await getGraphData();
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });

  test('returns a node per theme with correct fields', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const e = await seedEntry('Hello graph');
    const t = await seedTheme('Alpha Theme');
    await linkEntryToTheme(e.id, t);

    const { nodes, edges } = await getGraphData();
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    expect(node.id).toBe(t);
    expect(node.label).toBe('Alpha Theme');
    expect(node.entryCount).toBe(1);
  });

  test('uses user_name as label when set', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const { openDb } = require('../../../src/backend/db/connection');
    const t = await seedTheme('LLM Name');
    const db = await openDb();
    db.prepare('UPDATE themes SET user_name = ? WHERE id = ?').run('My Custom Name', t);

    const { nodes } = await getGraphData();
    const node = nodes.find((n) => n.id === t);
    expect(node.label).toBe('My Custom Name');
  });

  test('reports zero edges when themes share no entries', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const e1 = await seedEntry('Entry for theme A');
    const e2 = await seedEntry('Entry for theme B');
    const t1 = await seedTheme('Theme A');
    const t2 = await seedTheme('Theme B');
    await linkEntryToTheme(e1.id, t1);
    await linkEntryToTheme(e2.id, t2);

    const { edges } = await getGraphData();
    expect(edges).toHaveLength(0);
  });

  test('creates an edge when two themes share an entry', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const shared = await seedEntry('Shared entry');
    const t1 = await seedTheme('Theme A');
    const t2 = await seedTheme('Theme B');
    await linkEntryToTheme(shared.id, t1);
    await linkEntryToTheme(shared.id, t2);

    const { edges } = await getGraphData();
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    // source/target are theme ids (order depends on iteration, both valid)
    expect([edge.source, edge.target]).toContain(t1);
    expect([edge.source, edge.target]).toContain(t2);
    expect(edge.weight).toBe(1);
  });

  test('edge weight reflects number of shared entries', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const e1 = await seedEntry('Shared entry 1');
    const e2 = await seedEntry('Shared entry 2');
    const t1 = await seedTheme('Theme X');
    const t2 = await seedTheme('Theme Y');
    await linkEntryToTheme(e1.id, t1);
    await linkEntryToTheme(e1.id, t2);
    await linkEntryToTheme(e2.id, t1);
    await linkEntryToTheme(e2.id, t2);

    const { edges } = await getGraphData();
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2);
  });

  test('nodes are ordered by entry count descending', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    const t1 = await seedTheme('Small Theme');
    const t2 = await seedTheme('Large Theme');
    // Give t2 more entries
    for (let i = 0; i < 5; i++) {
      const e = await seedEntry(`Entry ${i}`);
      await linkEntryToTheme(e.id, t2);
    }
    const e = await seedEntry('Single entry');
    await linkEntryToTheme(e.id, t1);

    const { nodes } = await getGraphData();
    expect(nodes[0].id).toBe(t2);
    expect(nodes[0].entryCount).toBe(5);
    expect(nodes[1].id).toBe(t1);
    expect(nodes[1].entryCount).toBe(1);
  });

  test('handles themes with no entries', async () => {
    const { getGraphData } = require('../../../src/backend/db/graph');
    await seedTheme('Empty Theme');

    const { nodes, edges } = await getGraphData();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].entryCount).toBe(0);
    expect(edges).toHaveLength(0);
  });
});
