'use strict';

const path = require('path');

// Priority: explicit env var (tests/CLI) → Electron userData → local .data fallback
let userDataPath;
if (process.env.NEUROLOGUE_DATA_PATH) {
  userDataPath = process.env.NEUROLOGUE_DATA_PATH;
} else {
  try {
    const { app } = require('electron');
    userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', '.data');
  } catch {
    userDataPath = path.join(__dirname, '..', '.data');
  }
}

const config = {
  db: {
    path: path.join(userDataPath, 'neurologue.db'),
  },
  vectorStore: {
    path: path.join(userDataPath, 'vector-store'),
  },
  settings: {
    // User-editable runtime preferences (model choices etc.)
    path: path.join(userDataPath, 'settings.json'),
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    // Defaults — overridden at runtime by src/backend/settings.js
    embeddingModel: 'nomic-embed-text',
    llmModel: 'phi3:mini',
  },
};

module.exports = config;
