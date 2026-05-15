'use strict';

const { openDb } = require('./connection');

/**
 * Build graph data for the knowledge graph view.
 *
 * Nodes  — one per theme, with label and entry count.
 * Edges  — one per pair of themes that share ≥1 entry; weight = shared count.
 *
 * @returns {Promise<{ nodes: object[], edges: object[] }>}
 */
async function getGraphData() {
  const db = await openDb();

  const themes = db.prepare(`
    SELECT t.id,
           COALESCE(t.user_name, t.name) AS label,
           COUNT(te.entry_id)            AS entry_count
    FROM   themes t
    LEFT JOIN theme_entries te ON te.theme_id = t.id
    GROUP  BY t.id
    ORDER  BY entry_count DESC
  `).all();

  if (themes.length === 0) return { nodes: [], edges: [] };

  // All theme_entries rows — used to compute pairwise overlap
  const teRows = db.prepare('SELECT theme_id, entry_id FROM theme_entries').all();

  // Build theme → entry-id Set map
  const themeToEntries = Object.create(null);
  teRows.forEach(({ theme_id, entry_id }) => {
    if (!themeToEntries[theme_id]) themeToEntries[theme_id] = new Set();
    themeToEntries[theme_id].add(entry_id);
  });

  // Pairwise overlap edges (O(n²) over themes, which are few)
  const edges = [];
  for (let i = 0; i < themes.length; i++) {
    for (let j = i + 1; j < themes.length; j++) {
      const a = themeToEntries[themes[i].id] || new Set();
      const b = themeToEntries[themes[j].id] || new Set();
      let shared = 0;
      a.forEach((e) => { if (b.has(e)) shared++; });
      if (shared > 0) {
        edges.push({ source: themes[i].id, target: themes[j].id, weight: shared });
      }
    }
  }

  const nodes = themes.map((t) => ({
    id:         t.id,
    label:      t.label || `Theme ${t.id.slice(0, 6)}`,
    entryCount: t.entry_count,
  }));

  return { nodes, edges };
}

module.exports = { getGraphData };
