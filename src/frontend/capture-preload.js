'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capture', {
  /**
   * Save a captured entry.
   * @param {{ content: string, tags: string[] }} data
   * @returns {Promise<{ ok: boolean, id: string }>}
   */
  save: (data) => ipcRenderer.invoke('capture:save', data),

  /** Close the popup without saving. */
  close: () => ipcRenderer.send('capture:close'),
});
