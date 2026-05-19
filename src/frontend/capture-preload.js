'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capture', {
  /**
   * Save a captured entry.
   * @param {{ content: string, tags: string[] }} data
   * @returns {Promise<{ ok: boolean, id: string }>}
   */
  save: (data) => ipcRenderer.invoke('capture:save', data),

  /** Suggest tags for a piece of text. */
  suggestTags: (text) => ipcRenderer.invoke('library:suggest-tags', { text }),

  /** Close the popup without saving. */
  close: () => ipcRenderer.send('capture:close'),

  /** Read persisted settings. */
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /** Portfolio manifest — used to show the active profile in the titlebar. */
  getPortfolioManifest: () => ipcRenderer.invoke('portfolio:list'),

  /** Draft persistence — survives accidental blur/dismiss. */
  saveDraft:  (data) => ipcRenderer.invoke('capture:save-draft', data),
  loadDraft:  ()     => ipcRenderer.invoke('capture:load-draft'),
  clearDraft: ()     => ipcRenderer.invoke('capture:clear-draft'),
});
