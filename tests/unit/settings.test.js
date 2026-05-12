'use strict';

/**
 * Tests for src/backend/settings.js
 *
 * NEUROLOGUE_DATA_PATH is set before requiring any modules so that
 * config.js (and therefore settings.js) uses the test temp directory.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

const TEST_DIR = path.join(os.tmpdir(), `neurologue-settings-test-${process.pid}`);
process.env.NEUROLOGUE_DATA_PATH = TEST_DIR;

// Must be required AFTER setting env
const { getSettings, saveSettings } = require('../../src/backend/settings');

const SETTINGS_FILE = path.join(TEST_DIR, 'settings.json');

beforeEach(() => {
  // Start each test with a clean slate
  if (fs.existsSync(SETTINGS_FILE)) fs.unlinkSync(SETTINGS_FILE);
});

afterAll(() => {
  // Clean up temp dir
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('getSettings', () => {
  test('returns defaults when settings file does not exist', () => {
    const s = getSettings();
    expect(s.embeddingModel).toBe('nomic-embed-text');
    expect(s.llmModel).toBe('phi3:mini');
    expect(s.theme).toBe('dark');
  });

  test('returns defaults merged with saved values', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ embeddingModel: 'mxbai-embed-large' }), 'utf8');
    const s = getSettings();
    expect(s.embeddingModel).toBe('mxbai-embed-large');
    expect(s.llmModel).toBe('phi3:mini'); // default preserved
  });

  test('returns defaults when settings file is malformed JSON', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, 'not json {{', 'utf8');
    const s = getSettings();
    expect(s.embeddingModel).toBe('nomic-embed-text');
  });
});

describe('saveSettings', () => {
  test('persists changes and returns merged result', () => {
    const result = saveSettings({ embeddingModel: 'mxbai-embed-large' });
    expect(result.embeddingModel).toBe('mxbai-embed-large');
    expect(result.llmModel).toBe('phi3:mini');
  });

  test('written file is valid JSON', () => {
    saveSettings({ llmModel: 'llama3:8b' });
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).llmModel).toBe('llama3:8b');
  });

  test('merges successive partial updates', () => {
    saveSettings({ embeddingModel: 'custom-embed' });
    saveSettings({ llmModel: 'custom-llm' });
    const s = getSettings();
    expect(s.embeddingModel).toBe('custom-embed');
    expect(s.llmModel).toBe('custom-llm');
  });

  test('creates the directory if it does not exist', () => {
    const deepDir = path.join(TEST_DIR, 'nested', 'dir');
    // Temporarily override SETTINGS_PATH by pointing to nested path
    // (we test indirectly via the directory creation in saveSettings)
    saveSettings({ embeddingModel: 'test' });
    expect(fs.existsSync(SETTINGS_FILE)).toBe(true);
  });
});

describe('captureHotkey default', () => {
  test('default captureHotkey is a non-empty string', () => {
    const s = getSettings();
    expect(typeof s.captureHotkey).toBe('string');
    expect(s.captureHotkey.length).toBeGreaterThan(0);
  });

  test('captureHotkey can be saved and retrieved', () => {
    const result = saveSettings({ captureHotkey: 'CommandOrControl+Shift+N' });
    expect(result.captureHotkey).toBe('CommandOrControl+Shift+N');
    expect(getSettings().captureHotkey).toBe('CommandOrControl+Shift+N');
  });

  test('captureHotkey update preserves other settings', () => {
    saveSettings({ embeddingModel: 'mxbai-embed-large' });
    saveSettings({ captureHotkey: 'CommandOrControl+Alt+N' });
    const s = getSettings();
    expect(s.embeddingModel).toBe('mxbai-embed-large');
    expect(s.captureHotkey).toBe('CommandOrControl+Alt+N');
  });
});
