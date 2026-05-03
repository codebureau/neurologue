'use strict';

const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const { runMigrations } = require('./db/migrate');
const { initVectorStore } = require('./backend/vector/store');

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

app.whenReady().then(async () => {
  await initialise();
  createMainWindow();

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
