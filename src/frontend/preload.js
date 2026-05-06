'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neurologue', {
  version: '0.1.0',

  // ── Library ──────────────────────────────────────────────────────────────
  list: (opts) => ipcRenderer.invoke('library:list', opts),
  searchText: (query, opts) => ipcRenderer.invoke('library:search-text', { query, ...opts }),
  searchSemantic: (query, opts) => ipcRenderer.invoke('library:search-semantic', { query, ...opts }),
  getEntry: (id) => ipcRenderer.invoke('library:get-entry', { id }),
  updateEntry: (id, content) => ipcRenderer.invoke('library:update-entry', { id, content }),
  getRevisions: (id) => ipcRenderer.invoke('library:get-revisions', { id }),
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

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings:  ()        => ipcRenderer.invoke('settings:get'),
  saveSettings: (updates) => ipcRenderer.invoke('settings:save', updates),
  setHotkey:    (accelerator) => ipcRenderer.invoke('hotkey:set', { accelerator }),
  pauseHotkey:  ()            => ipcRenderer.invoke('hotkey:pause'),
  resumeHotkey: ()            => ipcRenderer.invoke('hotkey:resume'),

  // ── Capture ───────────────────────────────────────────────────────────────
  openCapture: () => ipcRenderer.invoke('capture:open'),

  // ── Ollama setup ─────────────────────────────────────────────────────────
  openOllamaDownload:  ()     => ipcRenderer.invoke('ollama:open-download'),
  checkOllamaInstalled: ()    => ipcRenderer.invoke('ollama:check-installed'),
  pullModel:           (name) => ipcRenderer.invoke('ollama:pull-model', { name }),
  onPullProgress:      (cb)   => { ipcRenderer.on('ollama:pull-progress', (_e, d) => cb(d)); },
});

