'use strict';

const path = require('path');

// Priority: explicit env var (tests/CLI) → Electron userData → OS-standard path → local .data fallback
function _osUserDataPath() {
  const name = 'neurologue';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'), name);
  } else if (process.platform === 'darwin') {
    return path.join(require('os').homedir(), 'Library', 'Application Support', name);
  } else {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config'), name);
  }
}

let userDataPath;
if (process.env.NEUROLOGUE_DATA_PATH) {
  userDataPath = process.env.NEUROLOGUE_DATA_PATH;
} else {
  try {
    const { app } = require('electron');
    userDataPath = app ? app.getPath('userData') : _osUserDataPath();
  } catch {
    userDataPath = _osUserDataPath();
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
  hotkey: {
    capture: 'CommandOrControl+Shift+Space',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    // Defaults — overridden at runtime by src/backend/settings.js
    embeddingModel: 'nomic-embed-text',
    llmModel: 'phi3:mini',
  },
};

module.exports = config;
