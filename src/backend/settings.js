'use strict';

/**
 * User-editable runtime settings (model choices etc.).
 *
 * Persisted as JSON in the app's user-data directory alongside the SQLite DB.
 * Falls back to hard-coded defaults from config.js when the file is absent.
 *
 * All reads are synchronous — the file is tiny and only called from the main
 * process.  Do not require this module from the renderer.
 */

const fs   = require('fs');
const path = require('path');
const config = require('../config');

const SETTINGS_PATH = config.settings.path;

/** @type {{ embeddingModel: string, llmModel: string, captureHotkey: string, tagSuggestionFormat: string, tagSimilarityThreshold: number, workerIntervals: object, theme: string }} */
const DEFAULTS = {
  embeddingModel:         config.ollama.embeddingModel,
  llmModel:               config.ollama.llmModel,
  captureHotkey:          config.hotkey.capture,
  tagSuggestionFormat:    'hyphenated', // 'hyphenated' = two-words, 'concatenated' = twowords
  tagSimilarityThreshold: 0.88,         // cosine similarity cutoff for semantic tag dedup
  workerIntervals: {
    embedding:     60,   // seconds between embedding scan ticks
    clustering:    300,  // seconds between clustering runs (also triggers theming)
    contradiction: 900,  // seconds between contradiction scan runs
  },
  signalsEnabled: true,   // enable LLM entry signal classification (Pass 3)
  contradictionScope: 'themes', // 'themes' | 'tags' | 'global'
  contradictionScheduledCap: 15, // max pairs checked per scheduled scan run
  theme: 'dark',          // 'dark' | 'light'
  homeView: 'library',    // view id to show on launch
  navHistoryLimit: 10,    // max entries in session nav stack
  portfoliosEnabled: false, // opt-in: multiple named corpus profiles
  scheduledExport: {
    enabled:     false,
    frequency:   'daily',   // 'daily' | 'weekly'
    destDir:     null,      // absolute path chosen by user
    includeDiff: false,
    adapterIds:  [],        // adapter ids to run after each CCF snapshot
    lastRun:     null,
  },
};

/**
 * Read persisted settings, merged over defaults.
 * Returns defaults when the settings file does not exist or is malformed.
 * @returns {{ embeddingModel: string, llmModel: string }}
 */
function getSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persist a partial settings update and return the merged result.
 * @param {Partial<{embeddingModel: string, llmModel: string}>} updates
 * @returns {{ embeddingModel: string, llmModel: string }}
 */
function saveSettings(updates) {
  const next = { ...getSettings(), ...updates };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = { getSettings, saveSettings };
