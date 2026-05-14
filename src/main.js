'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { initVectorStore, searchNearest, deleteVector } = require('./backend/vector/store');
const { createEntry, listEntries, updateEntry, deleteEntry, getEntryRevisions, updateEntryCategory, getActivityByDay } = require('./backend/db/entries');
const { setTagsForEntry, listTags, listTagsWithCounts, renameTag, deleteTag, mergeTag, findSimilarTags } = require('./backend/db/tags');
const { searchEntriesText, listEntriesByTag, getEntryWithTags, listEntriesWithTags, listEntriesFiltered, listCategoriesWithCounts } = require('./backend/db/search');
const { getEmbedding } = require('./backend/db/embeddings');
const { generateEmbedding, isOllamaAvailable, getOllamaStatus, checkOllamaInstalled, pullModel, suggestTags } = require('./worker/ollama');
const { getSettings, saveSettings } = require('./backend/settings');
const { listThemes, getThemeById, renameTheme, deleteTheme, getThemeWeeklyActivity } = require('./backend/db/themes');
const { listContradictions, resolveContradiction, dismissContradiction } = require('./backend/db/contradictions');
const { runClustering } = require('./backend/clustering/themes');
const { runExport } = require('./backend/export/runner');
const { registerCaptureHotkey, reRegisterCaptureHotkey, pauseCaptureHotkey, resumeCaptureHotkey, openCaptureWindow } = require('./capture/hotkey');
const { startWorker, stopWorker, setMainWindow, workerStatus, getWorkerLog, setWorkerIntervals, reindexAll, reindexEntry, scanContradictions, recomputeMetrics } = require('./worker/index');
const { listLatestThemeMetrics, getThemeMetricsHistory, listThemesWithDrift } = require('./backend/db/theme_metrics');
const { getEntrySignals, getSignalsByTheme } = require('./backend/db/entry_signals');
// getOllamaStatus and getSettings imported above

async function initialise() {
  await runMigrations();
  await initVectorStore();
}

let _mainWindow = null;

/**
 * Wrap an IPC handler so that unhandled rejections are forwarded to the
 * renderer as a toast notification rather than silently disappearing.
 * @param {string} channel
 * @param {Function} fn
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.error(`[IPC] ${channel} threw:`, err);
      if (_mainWindow && !_mainWindow.isDestroyed()) {
        _mainWindow.webContents.send('app:ipc-error', { channel, message: msg });
      }
      throw err; // still reject so the renderer's own catch can handle it
    }
  });
}

function createMainWindow() {
  _mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'frontend', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  _mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  _mainWindow.on('closed', () => { _mainWindow = null; });
}

// IPC: renderer sends { content, tags } → main writes to DB
ipcMain.handle('capture:save', async (_event, { content, tags }) => {
  const entry = await createEntry({ content, source: 'manual', type: 'note' });
  if (tags && tags.length > 0) {
    await setTagsForEntry(entry.id, tags);
  }
  return { ok: true, id: entry.id };
});

// IPC: renderer requests close (Escape key)
ipcMain.on('capture:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

// ── Library IPC ──────────────────────────────────────────────────────────────

// List entries (paginated) — supports tag, category, and text-query filters combined
ipcMain.handle('library:list', async (_event, { limit = 50, offset = 0, tag, category } = {}) => {
  if (tag || category) return listEntriesFiltered({ tag, category, limit, offset });
  return listEntriesWithTags({ limit, offset });
});

// Full-text search — optionally narrowed by active tag / category filter
ipcMain.handle('library:search-text', async (_event, { query, tag, category, limit = 50, offset = 0 }) => {
  if (!query || !query.trim()) return listEntriesFiltered({ tag, category, limit, offset });
  return listEntriesFiltered({ query, tag, category, limit, offset });
});

// Distinct categories in use (for sidebar)
ipcMain.handle('library:list-categories', async () => listCategoriesWithCounts());

// Semantic search — requires Ollama to be running
handle('library:search-semantic', async (_event, { query, topN = 10 }) => {
  const available = await isOllamaAvailable();
  if (!available) return { ok: false, reason: 'ollama_unavailable', results: [] };
  const queryVector = await generateEmbedding(query);
  const hits = await searchNearest(queryVector, topN);
  // Enrich with full entry + tags
  const entries = await Promise.all(
    hits.map(async (h) => {
      const entry = await getEntryWithTags(h.entry_id);
      return entry ? { ...entry, _distance: h._distance } : null;
    })
  );
  return { ok: true, results: entries.filter(Boolean) };
});

// Semantic neighbours — find entries similar to a given entry (no Ollama needed)
handle('library:similar-entries', async (_event, { id, topN = 8 }) => {
  const emb = await getEmbedding(id);
  if (!emb) return { ok: false, reason: 'no_embedding', results: [] };
  // topN + 1 so we can exclude the source entry itself
  const hits = await searchNearest(emb.vector, topN + 1);
  const neighbours = hits.filter((h) => h.entry_id !== id).slice(0, topN);
  const entries = await Promise.all(
    neighbours.map(async (h) => {
      const entry = await getEntryWithTags(h.entry_id);
      return entry ? { ...entry, _distance: h._distance } : null;
    })
  );
  return { ok: true, results: entries.filter(Boolean) };
});
ipcMain.handle('library:get-entry', async (_event, { id }) => {
  return getEntryWithTags(id);
});

// Update entry content (soft edit — preserves original + revision history)
ipcMain.handle('library:update-entry', async (_event, { id, content }) => {
  if (!id || !content || !content.trim()) return { ok: false, error: 'Invalid input' };
  const entry = await updateEntry(id, content.trim());
  return entry ? { ok: true, entry } : { ok: false, error: 'Entry not found' };
});

// Get revision history for an entry
ipcMain.handle('library:get-revisions', async (_event, { id }) => {
  return getEntryRevisions(id);
});

// Update (or clear) the category for an entry (user override)
ipcMain.handle('library:set-category', async (_event, { id, category }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  const entry = await updateEntryCategory(id, category || null, 'user');
  return entry ? { ok: true, entry } : { ok: false, error: 'Entry not found' };
});

// Delete a single entry (SQLite rows + LanceDB vector)
ipcMain.handle('library:delete-entry', async (_event, { id }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  await deleteEntry(id);
  await deleteVector(id).catch(() => {}); // vector may not exist yet — ignore
  return { ok: true };
});

// Delete multiple entries in one call
ipcMain.handle('library:bulk-delete-entries', async (_event, { ids }) => {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'Invalid input' };
  for (const id of ids) {
    await deleteEntry(id);
    await deleteVector(id).catch(() => {});
  }
  return { ok: true, deleted: ids.length };
});

// Delete a theme
ipcMain.handle('library:delete-theme', async (_event, { id }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  await deleteTheme(id);
  return { ok: true };
});

// List all tags (for sidebar)
ipcMain.handle('library:list-tags', async () => {
  return listTags();
});

// Activity heatmap: entry counts by day for the last 364 days
ipcMain.handle('library:activity', async () => getActivityByDay(364));

// Update tags for an existing entry
ipcMain.handle('library:set-tags', async (_event, { id, tags }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  await setTagsForEntry(id, Array.isArray(tags) ? tags : []);
  const entry = await getEntryWithTags(id);
  return entry ? { ok: true, entry } : { ok: false, error: 'Entry not found' };
});

// Suggest tags for a piece of text (used by capture + detail panel)
ipcMain.handle('library:suggest-tags', async (_event, { text }) => {
  if (!text || !text.trim()) return { ok: true, suggestions: [] };
  try {
    const known = (await listTags()).map((t) => t.name);
    const suggestions = await suggestTags(text.trim(), known);
    return { ok: true, suggestions };
  } catch (err) {
    return { ok: false, suggestions: [], error: err.message };
  }
});

// ── Tag management IPC ──────────────────────────────────────────────────────

ipcMain.handle('tags:list-with-counts', async () => listTagsWithCounts());

ipcMain.handle('tags:rename', async (_event, { id, newName }) => {
  if (!id || !newName) return { ok: false, error: 'Invalid input' };
  return renameTag(id, newName);
});

ipcMain.handle('tags:delete', async (_event, { id }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  return deleteTag(id);
});

ipcMain.handle('tags:merge', async (_event, { removeId, keepId }) => {
  if (!removeId || !keepId) return { ok: false, error: 'Invalid input' };
  if (removeId === keepId) return { ok: false, error: 'Cannot merge a tag with itself' };
  return mergeTag(removeId, keepId);
});

ipcMain.handle('tags:similar', async () => {
  const settings  = getSettings();
  const threshold = typeof settings.tagSimilarityThreshold === 'number'
    ? settings.tagSimilarityThreshold
    : 0.88;

  // Always run the fast structural pass (format variants + spelling)
  const structural = await findSimilarTags();
  const structuralKeys = new Set(structural.map((p) => [p.a.id, p.b.id].sort().join('|')));

  // Semantic pass — only when Ollama is available
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) return structural;

  const tags = await listTagsWithCounts();
  if (tags.length < 2) return structural;

  // Embed all tag names concurrently (best-effort — skip failures)
  const embeddings = Object.create(null);
  await Promise.all(tags.map(async (tag) => {
    try {
      embeddings[tag.id] = await generateEmbedding(tag.name);
    } catch { /* skip tag if embedding fails */ }
  }));

  function cosineSim(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  const semanticPairs = [];
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      const a = tags[i], b = tags[j];
      const key = [a.id, b.id].sort().join('|');
      if (structuralKeys.has(key)) continue; // already flagged structurally
      const ea = embeddings[a.id], eb = embeddings[b.id];
      if (!ea || !eb) continue;
      const sim = cosineSim(ea, eb);
      if (sim >= threshold) {
        semanticPairs.push({ a, b, reason: 'similar-meaning', similarity: Math.round(sim * 100) });
      }
    }
  }

  // Semantic pairs sorted by similarity desc, then appended after structural
  semanticPairs.sort((x, y) => y.similarity - x.similarity);
  return [...structural, ...semanticPairs];
});

// ── Themes IPC ───────────────────────────────────────────────────────────────

// List all themes with their entry count
ipcMain.handle('themes:list', async () => {
  const themes = await listThemes();
  return themes;
});

// Get a single theme with its member entries
ipcMain.handle('themes:get', async (_event, { id }) => {
  return getThemeById(id);
});

// Rename a theme (stores as user_name, preserved across re-clustering)
ipcMain.handle('themes:rename', async (_event, { id, newName }) => {
  if (!newName || !newName.trim()) throw new Error('Name cannot be empty');
  return renameTheme(id, newName.trim());
});

ipcMain.handle('themes:delete', async (_event, { id }) => {
  if (!id) return { ok: false, error: 'Invalid input' };
  await deleteTheme(id);
  return { ok: true };
});

ipcMain.handle('themes:weekly-activity', async (_e, { id, weeks = 12 }) =>
  getThemeWeeklyActivity(id, weeks)
);

// Manually trigger clustering (for dev/debug)
ipcMain.handle('themes:cluster', async () => {
  return runClustering();
});

// ── Contradictions IPC ───────────────────────────────────────────────────────

ipcMain.handle('contradictions:list', async (_e, { status = 'active' } = {}) => {
  return listContradictions({ status });
});

ipcMain.handle('contradictions:resolve', async (_e, { id, notes = '' }) => {
  if (!id) return { ok: false, error: 'Missing id' };
  await resolveContradiction(id, notes);
  return { ok: true };
});

ipcMain.handle('contradictions:dismiss', async (_e, { id }) => {
  if (!id) return { ok: false, error: 'Missing id' };
  await dismissContradiction(id);
  return { ok: true };
});

ipcMain.handle('contradictions:scan', async () => {
  return scanContradictions();
});

// ── Priorities IPC ───────────────────────────────────────────────────────────

handle('priorities:list-metrics', async () => {
  const metrics = await listThemesWithDrift();
  // Enrich with theme name
  return Promise.all(metrics.map(async (m) => {
    const theme = await getThemeById(m.theme_id);
    return { ...m, theme_name: theme ? (theme.user_name || theme.name || 'Unnamed') : 'Deleted theme' };
  }));
});

handle('priorities:get-entry-signals', async (_event, { themeId }) => {
  return getSignalsByTheme(themeId);
});

handle('priorities:get-history', async (_event, { themeId }) => {
  return getThemeMetricsHistory(themeId);
});

handle('priorities:recompute', async () => {
  const n = await recomputeMetrics();
  return { updated: n };
});

// ── Help IPC ─────────────────────────────────────────────────────────────────

ipcMain.handle('help:open', () => {
  shell.openExternal('https://codebureau.github.io/neurologue');
});
// Open the Ollama download page in the system browser
ipcMain.handle('ollama:open-download', () => {
  shell.openExternal('https://ollama.ai');
});
// ── Export IPC ───────────────────────────────────────────────────────────────

// Show native folder picker and run export to chosen directory
ipcMain.handle('export:run', async (_event, { formats } = {}) => {
  const { dialog } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
    title: 'Choose export folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }
  const result = await runExport(filePaths[0], { formats });
  return { canceled: false, destDir: filePaths[0], ...result };
});

app.whenReady().then(async () => {
  await initialise();
  createMainWindow();
  const { captureHotkey } = getSettings();
  registerCaptureHotkey(captureHotkey);
  startWorker();
  // Wire the worker to push IPC events to the library window once it is ready
  _mainWindow.webContents.on('did-finish-load', () => {
    setMainWindow(_mainWindow.webContents);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

// ── Status IPC ────────────────────────────────────────────────────────────

// Renderer calls this on startup to get initial status before the first push
ipcMain.handle('status:get', async () => {
  const ollama = await getOllamaStatus();
  return { worker: workerStatus(), ollama };
});

// ── Reindex IPC ───────────────────────────────────────────────────────────

// Clears ALL embeddings so the worker re-processes every entry
ipcMain.handle('worker:reindex-all', async () => {
  return reindexAll();
});

// Clears the embedding for a single entry so the worker re-processes it
ipcMain.handle('worker:reindex-entry', async (_e, { id }) => {
  if (!id) return { ok: false, error: 'Missing id' };
  return reindexEntry(id);
});

// ── Settings IPC ──────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, updates) => {
  const result = saveSettings(updates);
  // Propagate interval changes to running worker immediately
  if (updates.workerIntervals) setWorkerIntervals(updates.workerIntervals);
  return result;
});

// ── Worker log IPC ───────────────────────────────────────────────────────
ipcMain.handle('worker:get-log', () => getWorkerLog());

// ── Hotkey IPC ────────────────────────────────────────────────────────────

ipcMain.handle('hotkey:set', (_e, { accelerator }) => {
  const result = reRegisterCaptureHotkey(accelerator);
  if (result.ok) saveSettings({ captureHotkey: accelerator });
  return result;
});

ipcMain.handle('hotkey:pause',  () => { pauseCaptureHotkey(); });
ipcMain.handle('hotkey:resume', () => { resumeCaptureHotkey(); });

ipcMain.handle('capture:open',  () => { openCaptureWindow(); });

// ── Ollama setup IPC ───────────────────────────────────────────────────────

ipcMain.handle('ollama:check-installed', () => checkOllamaInstalled());

// Pull a model — long-running; streams NDJSON progress back to renderer
ipcMain.handle('ollama:pull-model', async (event, { name }) => {
  try {
    await pullModel(name, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('ollama:pull-progress', { name, ...progress });
      }
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopWorker();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

