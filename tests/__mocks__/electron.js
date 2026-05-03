'use strict';

// Minimal manual mock for the `electron` module.
// Prevents "Cannot find module 'electron'" errors when running Jest outside Electron.

const path = require('path');
const os = require('os');

const app = {
  getPath: (name) => {
    if (name === 'userData') return path.join(os.tmpdir(), 'neurologue-test');
    return os.tmpdir();
  },
  quit: jest.fn(),
};

const BrowserWindow = jest.fn();
const globalShortcut = { register: jest.fn(), unregisterAll: jest.fn() };
const ipcMain = { handle: jest.fn(), on: jest.fn() };

module.exports = { app, BrowserWindow, globalShortcut, ipcMain };
