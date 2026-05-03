'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { initVectorStore } = require('./backend/vector/store');
const { createEntry } = require('./backend/db/entries');
const { setTagsForEntry } = require('./backend/db/tags');
const { listTags } = require('./backend/db/tags');
const { listEntries } = require('./backend/db/entries');
const { searchEntriesText, listEntriesByTag, getEntryWithTags } = require('./backend/db/search');
const { searchNearest } = require('./backend/vector/store');
const { generateEmbedding, isOllamaAvailable } = require('./worker/ollama');
const { registerCaptureHotkey } = require('./capture/hotkey');
const { startWorker, stopWorker } = require('./worker/index');

async function initialise() {
  await runMigrations();
  await initVectorStore();
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'frontend', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'frontend', 'index.html'));
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

// List entries (paginated, optional tag filter)
ipcMain.handle('library:list', async (_event, { limit = 50, offset = 0, tag } = {}) => {
  if (tag) return listEntriesByTag(tag, { limit, offset });
  return listEntries({ limit, offset });
});

// Full-text search
ipcMain.handle('library:search-text', async (_event, { query, limit = 50, offset = 0 }) => {
  if (!query || !query.trim()) return listEntries({ limit, offset });
  return searchEntriesText(query, { limit, offset });
});

// Semantic search — requires Ollama to be running
ipcMain.handle('library:search-semantic', async (_event, { query, topN = 10 }) => {
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

// Get a single entry with its tags
ipcMain.handle('library:get-entry', async (_event, { id }) => {
  return getEntryWithTags(id);
});

// List all tags (for sidebar)
ipcMain.handle('library:list-tags', async () => {
  return listTags();
});

app.whenReady().then(async () => {
  await initialise();
  createMainWindow();
  registerCaptureHotkey();
  startWorker();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopWorker();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

