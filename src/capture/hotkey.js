'use strict';

const { BrowserWindow, globalShortcut, app } = require('electron');
const path = require('path');

const HOTKEY = 'CommandOrControl+Shift+Space';

let _captureWin = null;

/**
 * Open (or focus) the capture popup window.
 */
function openCaptureWindow() {
  if (_captureWin && !_captureWin.isDestroyed()) {
    _captureWin.focus();
    return;
  }

  _captureWin = new BrowserWindow({
    width: 560,
    height: 260,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'frontend', 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  _captureWin.loadFile(path.join(__dirname, '..', 'frontend', 'capture.html'));

  _captureWin.once('ready-to-show', () => {
    _captureWin.show();
    _captureWin.focus();
  });

  _captureWin.on('blur', () => {
    // Close the popup if it loses focus (user clicked away)
    if (_captureWin && !_captureWin.isDestroyed()) {
      _captureWin.close();
    }
  });

  _captureWin.on('closed', () => {
    _captureWin = null;
  });
}

/**
 * Close the capture popup, if open.
 */
function closeCaptureWindow() {
  if (_captureWin && !_captureWin.isDestroyed()) {
    _captureWin.close();
  }
}

/**
 * Register the global hotkey. Call once after app.whenReady().
 */
function registerCaptureHotkey() {
  const registered = globalShortcut.register(HOTKEY, openCaptureWindow);
  if (!registered) {
    console.warn(`[hotkey] Failed to register ${HOTKEY} — it may already be in use by another app.`);
  }

  app.on('will-quit', () => {
    globalShortcut.unregister(HOTKEY);
  });
}

module.exports = { registerCaptureHotkey, openCaptureWindow, closeCaptureWindow };
