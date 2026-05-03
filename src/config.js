'use strict';

const path = require('path');
const { app } = require('electron');

// Use app.getPath('userData') for production; fallback for worker/test contexts
const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '..', '.data');

const config = {
  db: {
    path: path.join(userDataPath, 'neurologue.db'),
  },
  vectorStore: {
    path: path.join(userDataPath, 'vector-store'),
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    embeddingModel: 'bge-small-en',
    llmModel: 'phi3:mini',
  },
};

module.exports = config;
