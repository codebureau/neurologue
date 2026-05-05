'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { initVectorStore } = require('./backend/vector/store');
const { createEntry } = require('./backend/db/entries');
const { setTagsForEntry } = require('./backend/db/tags');
const { listTags } = require('./backend/db/tags');
const { listEntries } = require('./backend/db/entries');
const { searchEntriesText, listEntriesByTag, getEntryWithTags } = require('./backend/db/search');
const { searchNearest } = require('./backend/vector/store');
const { generateEmbedding, isOllamaAvailable, getOllamaStatus, checkOllamaInstalled, pullModel, startOllama, stopOllama } = require('./worker/ollama');
const { getSettings, saveSettings } = require('./backend/settings');
const { listThemes, getThemeById, getEntriesForTheme } = require('./backend/db/themes');
const { runClustering } = require('./backend/clustering/themes');
const { runExport } = require('./backend/export/runner');
const { registerCaptureHotkey } = require('./capture/hotkey');
const { startWorker, stopWorker, setMainWindow, workerStatus } = require('./worker/index');
// getOllamaStatus and getSettings imported above

async function initialise() {
  await runMigrations();
  await initVectorStore();
}

let _mainWindow = null;

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

// ── Themes IPC ───────────────────────────────────────────────────────────────

// List all themes with their entry count
ipcMain.handle('themes:list', async () => {
  const themes = await listThemes();
  return themes;
});

// Get a single theme with its top entries (enriched with content + tags)
ipcMain.handle('themes:get', async (_event, { id }) => {
  const theme = await getThemeById(id);
  if (!theme) return null;
  const members = await getEntriesForTheme(id);
  const entries = await Promise.all(
    members.slice(0, 20).map(async ({ entry_id, score }) => {
      const entry = await getEntryWithTags(entry_id);
      return entry ? { ...entry, score } : null;
    })
  );
  return { ...theme, entries: entries.filter(Boolean) };
});

// Manually trigger clustering (for dev/debug)
ipcMain.handle('themes:cluster', async () => {
  return runClustering();
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
ipcMain.handle('export:run', async (_event, { includeEmbeddings = true } = {}) => {
  const { dialog } = require('electron');
  const win = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(win || undefined, {
    title: 'Choose export folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }
  const result = await runExport(filePaths[0], { includeEmbeddings });
  return { canceled: false, destDir: filePaths[0], ...result };
});

app.whenReady().then(async () => {
  await initialise();
  createMainWindow();
  registerCaptureHotkey();
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

// ── Settings IPC ──────────────────────────────────────────────────────────

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:save', (_e, updates) => saveSettings(updates));

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

// Start Ollama — spawns ollama serve, polls until available (up to 8 s)
ipcMain.handle('ollama:start', async () => {
  const result = await startOllama();
  if (!result.ok) return result;
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isOllamaAvailable()) return { ok: true };
  }
  return { ok: false, error: 'Ollama did not become available within 8 seconds' };
});

// Stop Ollama — kills our process or uses an OS-level kill
ipcMain.handle('ollama:stop', async () => {
  return stopOllama();
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopWorker();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

