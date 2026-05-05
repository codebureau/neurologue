'use strict';

jest.mock('electron');

const { globalShortcut } = require('electron');

// Re-require the module fresh for each describe block by resetting the module registry
let hotkey;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-mock electron after resetModules
  jest.mock('electron');
  hotkey = require('../../../src/capture/hotkey');
});

describe('DEFAULT_HOTKEY', () => {
  test('is a non-empty string', () => {
    expect(typeof hotkey.DEFAULT_HOTKEY).toBe('string');
    expect(hotkey.DEFAULT_HOTKEY.length).toBeGreaterThan(0);
  });
});

describe('registerCaptureHotkey', () => {
  test('registers the DEFAULT_HOTKEY when no accelerator is provided', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(true);
    hotkey.registerCaptureHotkey();
    expect(gs.register).toHaveBeenCalledWith(hotkey.DEFAULT_HOTKEY, expect.any(Function));
  });

  test('registers the provided accelerator', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(true);
    hotkey.registerCaptureHotkey('CommandOrControl+Shift+N');
    expect(gs.register).toHaveBeenCalledWith('CommandOrControl+Shift+N', expect.any(Function));
  });

  test('logs a warning when hotkey cannot be registered', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(false);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    hotkey.registerCaptureHotkey();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('reRegisterCaptureHotkey', () => {
  beforeEach(() => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(true);
    hotkey.registerCaptureHotkey(); // establish initial state (_currentHotkey = DEFAULT_HOTKEY)
    gs.register.mockClear();
    gs.unregister.mockClear();
  });

  test('returns { ok: true } when new hotkey registers successfully', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(true);
    const result = hotkey.reRegisterCaptureHotkey('CommandOrControl+Shift+N');
    expect(result).toEqual({ ok: true });
    expect(gs.unregister).toHaveBeenCalledWith(hotkey.DEFAULT_HOTKEY);
    expect(gs.register).toHaveBeenCalledWith('CommandOrControl+Shift+N', expect.any(Function));
  });

  test('returns { ok: false, conflict: true } when the new accelerator conflicts', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(false);
    const result = hotkey.reRegisterCaptureHotkey('CommandOrControl+Shift+N');
    expect(result).toEqual({ ok: false, conflict: true });
  });

  test('restores old hotkey when the new one conflicts', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValueOnce(false).mockReturnValue(true);
    hotkey.reRegisterCaptureHotkey('CommandOrControl+Shift+N');
    // Second register call should restore the DEFAULT_HOTKEY
    expect(gs.register).toHaveBeenCalledTimes(2);
    expect(gs.register.mock.calls[1][0]).toBe(hotkey.DEFAULT_HOTKEY);
  });

  test('updates _currentHotkey after a successful re-registration', () => {
    const { globalShortcut: gs } = require('electron');
    gs.register.mockReturnValue(true);
    hotkey.reRegisterCaptureHotkey('CommandOrControl+Alt+P');
    gs.register.mockClear();
    gs.unregister.mockClear();

    // A second re-registration should unregister the newly set key
    hotkey.reRegisterCaptureHotkey('CommandOrControl+Alt+Q');
    expect(gs.unregister).toHaveBeenCalledWith('CommandOrControl+Alt+P');
  });
});
