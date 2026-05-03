'use strict';

const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { initVectorStore } = require('./backend/vector/store');
const { createEntry } = require('./backend/db/entries');
const { setTagsForEntry } = require('./backend/db/tags');
const { registerCaptureHotkey } = require('./capture/hotkey');

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

app.whenReady().then(async () => {
  await initialise();
  createMainWindow();
  registerCaptureHotkey();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
