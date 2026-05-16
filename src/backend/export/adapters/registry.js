'use strict';

/**
 * Adapter registry — single source of truth for all CCF export adapters.
 *
 * To add a new adapter:
 *   1. Create src/backend/export/<name>/index.js satisfying the contract below.
 *   2. Add one require() line here.
 *
 * Adapter contract:
 * -----------------
 *   module.exports = {
 *     id:          string,   // stable, hyphen-case, used in settings & IPC
 *     name:        string,   // human-readable label for the UI
 *     description: string,   // one-line description shown in the export modal
 *     export(ccfSnapshotDir, destDir) {
 *       // Pure CCF-to-output transformation.  No DB access, no IPC.
 *       // Both paths are absolute strings.  destDir is created by the adapter.
 *       // Returns: { files: string[], entryCount: number, themeCount: number }
 *     },
 *   };
 */

const ADAPTERS = [
  require('../onenote'),
  require('../notebooklm'),
  require('../copilot'),
];

/**
 * Return all registered adapters.
 * @returns {object[]}
 */
function listAdapters() {
  return ADAPTERS;
}

/**
 * Return a single adapter by id, or null if not found.
 * @param {string} id
 * @returns {object|null}
 */
function getAdapter(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}

module.exports = { listAdapters, getAdapter };
