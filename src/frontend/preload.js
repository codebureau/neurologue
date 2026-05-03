'use strict';
// Preload script — runs in a sandboxed context between main and renderer.
// Exposes a safe API to the renderer via contextBridge (to be expanded in Phase 2+).

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('neurologue', {
  version: '0.1.0',
});
