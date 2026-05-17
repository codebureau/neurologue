'use strict';

const { BrowserWindow, globalShortcut, app } = require('electron');
const path = require('path');
const fs   = require('fs');

const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space';

const DEFAULT_BOUNDS  = { width: 560, height: 340 };
const MIN_BOUNDS      = { width: 440, height: 280 };

/** Currently registered accelerator — set by registerCaptureHotkey. */
let _currentHotkey = null;

let _captureWin = null;

// ── Bounds persistence ────────────────────────────────────────────────────

function _boundsFile() {
  try {
    return path.join(app.getPath('userData'), 'capture-window.json');
  } catch {
    return null;
  }
}

function _loadBounds() {
  try {
    const file = _boundsFile();
    if (!file) return DEFAULT_BOUNDS;
    const raw = fs.readFileSync(file, 'utf8');
    const saved = JSON.parse(raw);
    return {
      width:  Math.max(MIN_BOUNDS.width,  Number(saved.width)  || DEFAULT_BOUNDS.width),
      height: Math.max(MIN_BOUNDS.height, Number(saved.height) || DEFAULT_BOUNDS.height),
    };
  } catch {
    return DEFAULT_BOUNDS;
  }
}

function _saveBounds(win) {
  try {
    const file = _boundsFile();
    if (!file || win.isDestroyed()) return;
    const { width, height } = win.getBounds();
    fs.writeFileSync(file, JSON.stringify({ width, height }), 'utf8');
  } catch {
    // non-fatal
  }
}

/**
 * Open (or focus) the capture popup window.
 */
function openCaptureWindow() {
  if (_captureWin && !_captureWin.isDestroyed()) {
    _captureWin.focus();
    return;
  }

  const { width, height } = _loadBounds();

  _captureWin = new BrowserWindow({
    width,
    height,
    minWidth:  MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
    frame: false,
    resizable: true,
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
    // Close the popup if it loses focus (user clicked away).
    // Draft is auto-saved by the renderer on input, so content is preserved.
    if (_captureWin && !_captureWin.isDestroyed()) {
      _captureWin.close();
    }
  });

  // Save bounds on every close regardless of how the window is closed
  // (blur, Escape, Ctrl+Enter save, direct win.close() from IPC, etc.)
  _captureWin.on('close', () => {
    if (_captureWin && !_captureWin.isDestroyed()) {
      _saveBounds(_captureWin);
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

// ── Draft persistence ─────────────────────────────────────────────────────

function _draftFile() {
  try {
    return path.join(app.getPath('userData'), 'capture-draft.json');
  } catch {
    return null;
  }
}

/**
 * Persist a capture draft to disk. Clears the draft if content is empty.
 * @param {{ content: string, tags: string }} data
 */
function saveDraft({ content, tags }) {
  try {
    const file = _draftFile();
    if (!file) return;
    if (!content || !content.trim()) {
      clearDraft();
      return;
    }
    fs.writeFileSync(file, JSON.stringify({ content, tags: tags || '' }), 'utf8');
  } catch {
    // non-fatal
  }
}

/**
 * Load a previously saved draft, or return null if none exists.
 * @returns {{ content: string, tags: string } | null}
 */
function loadDraft() {
  try {
    const file = _draftFile();
    if (!file || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Delete the draft file, if present.
 */
function clearDraft() {
  try {
    const file = _draftFile();
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // non-fatal
  }
}

module.exports = { registerCaptureHotkey, reRegisterCaptureHotkey, pauseCaptureHotkey, resumeCaptureHotkey, openCaptureWindow, closeCaptureWindow, DEFAULT_HOTKEY, saveDraft, loadDraft, clearDraft };
