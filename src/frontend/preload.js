'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neurologue', {
  version: '0.1.0',

  // ── Library ──────────────────────────────────────────────────────────────
  list: (opts) => ipcRenderer.invoke('library:list', opts),
  searchText: (query, opts) => ipcRenderer.invoke('library:search-text', { query, ...opts }),
  searchSemantic: (query, opts) => ipcRenderer.invoke('library:search-semantic', { query, ...opts }),
  getEntry: (id) => ipcRenderer.invoke('library:get-entry', { id }),
  listTags: () => ipcRenderer.invoke('library:list-tags'),

  // ── Themes ───────────────────────────────────────────────────────────────
  listThemes: () => ipcRenderer.invoke('themes:list'),
  getTheme: (id) => ipcRenderer.invoke('themes:get', { id }),
  triggerClustering: () => ipcRenderer.invoke('themes:cluster'),
});

