'use strict';

const { BrowserWindow, globalShortcut, app } = require('electron');
const path = require('path');

const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space';

/** Currently registered accelerator — set by registerCaptureHotkey. */
let _currentHotkey = null;

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
 * @param {string} [accelerator] - Electron accelerator; defaults to DEFAULT_HOTKEY.
 */
function registerCaptureHotkey(accelerator) {
  _currentHotkey = accelerator || DEFAULT_HOTKEY;
  const registered = globalShortcut.register(_currentHotkey, openCaptureWindow);
  if (!registered) {
    console.warn(`[hotkey] Failed to register ${_currentHotkey} — it may already be in use by another app.`);
  }

  app.on('will-quit', () => {
    globalShortcut.unregister(_currentHotkey);
  });
}

/**
 * Unregister the current hotkey and register a new one.
 * Returns { ok: true } on success, { ok: false, conflict: true } if the new
 * shortcut is already claimed by another application.
 * @param {string} accelerator
 * @returns {{ ok: boolean, conflict?: boolean }}
 */
function reRegisterCaptureHotkey(accelerator) {
  const prev = _currentHotkey;
  globalShortcut.unregister(prev);
  const registered = globalShortcut.register(accelerator, openCaptureWindow);
  if (registered) {
    _currentHotkey = accelerator;
    return { ok: true };
  }
  // Conflict — restore the previous hotkey
  globalShortcut.register(prev, openCaptureWindow);
  return { ok: false, conflict: true };
}

/**
 * Temporarily unregister the capture hotkey (e.g. while the settings modal is open).
 */
function pauseCaptureHotkey() {
  if (_currentHotkey) globalShortcut.unregister(_currentHotkey);
}

/**
 * Re-register the capture hotkey after a pause.
 */
function resumeCaptureHotkey() {
  if (_currentHotkey) globalShortcut.register(_currentHotkey, openCaptureWindow);
}

module.exports = { registerCaptureHotkey, reRegisterCaptureHotkey, pauseCaptureHotkey, resumeCaptureHotkey, openCaptureWindow, closeCaptureWindow, DEFAULT_HOTKEY };
