'use strict';

const path = require('path');

// Priority: explicit env var (tests/CLI) → Electron userData → OS-standard path → local .data fallback
function _osUserDataPath() {
  const os = require('os');
  const home = os.homedir();
  const name = 'neurologue';
  // Use os.homedir() rather than %APPDATA%/%HOME% to avoid MSIX sandbox virtualisation
  // of environment variables when the process is spawned by a packaged app.
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', name);
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', name);
  } else {
    return path.join(home, '.config', name);
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
