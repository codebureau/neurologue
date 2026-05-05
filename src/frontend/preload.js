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
  // ── Export ───────────────────────────────────────────────────────────────
  exportAll: (opts) => ipcRenderer.invoke('export:run', opts),

  // ── Help ─────────────────────────────────────────────────────────────────
  openHelp: () => ipcRenderer.invoke('help:open'),

  // ── Status ───────────────────────────────────────────────────────────────
  getStatus: () => ipcRenderer.invoke('status:get'),
  onWorkerStatus:     (cb) => { ipcRenderer.on('worker:status',           (_e, d) => cb(d)); },
  onEntriesUpdated:   (cb) => { ipcRenderer.on('worker:entries-updated',  (_e, d) => cb(d)); },
  onThemesUpdated:    (cb) => { ipcRenderer.on('worker:themes-updated',   (_e, d) => cb(d)); },
});

