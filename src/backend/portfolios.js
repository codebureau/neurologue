'use strict';

/**
 * Portfolio (corpus profile) manifest manager.
 *
 * A portfolio is a self-contained Neurologue corpus: its own SQLite DB,
 * its own LanceDB vector store, and its own CCF snapshots.  Users switch
 * between portfolios at the app-shell level; the rest of the stack is
 * unaware of which portfolio is active.
 *
 * The manifest lives at {userData}/profiles.json and is the single source
 * of truth for the list of profiles and the currently active one.
 *
 * The portfolios feature is opt-in (portfoliosEnabled: false in settings).
 * This module is always loaded but the IPC surface is only exposed through
 * the feature-gated UI.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config = require('../config');

const MANIFEST_FILENAME  = 'profiles.json';
const DEFAULT_PROFILE_ID = 'default';

// ── Internal helpers ──────────────────────────────────────────────────────

function _userDataDir() {
  return path.dirname(config.db.path);
}

function _manifestPath() {
  return path.join(_userDataDir(), MANIFEST_FILENAME);
}

function _defaultProfile() {
  return {
    id:               DEFAULT_PROFILE_ID,
    name:             'Personal',
    color:            '#2AA6A1',
    dbPath:           config.db.path,
    vectorStorePath:  config.vectorStore.path,
    createdAt:        new Date().toISOString(),
  };
}

/**
 * Load the manifest from disk, auto-creating it on first run.
 * @returns {{ activeId: string, profiles: object[] }}
 */
function _loadManifest() {
  const file = _manifestPath();
  if (!fs.existsSync(file)) {
    const manifest = {
      activeId: DEFAULT_PROFILE_ID,
      profiles: [_defaultProfile()],
    };
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // Corrupted manifest — recreate with default
    const manifest = { activeId: DEFAULT_PROFILE_ID, profiles: [_defaultProfile()] };
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }
}

function _saveManifest(manifest) {
  fs.writeFileSync(_manifestPath(), JSON.stringify(manifest, null, 2), 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Return the full manifest: { activeId, profiles[] }.
 */
function listProfiles() {
  return _loadManifest();
}

/**
 * Return the currently active profile object.
 * Falls back to the first profile if activeId is stale.
 */
function getActiveProfile() {
  const manifest = _loadManifest();
  return manifest.profiles.find((p) => p.id === manifest.activeId) || manifest.profiles[0];
}

/**
 * Create a new profile with its own DB and vector store paths.
 * @param {string} name
 * @param {string} [color]
 * @returns {object} The new profile.
 */
function createProfile(name, color) {
  if (!name || !name.trim()) throw new Error('Profile name is required');
  const manifest = _loadManifest();

  const id  = crypto.randomUUID();
  const dir = _userDataDir();

  const profile = {
    id,
    name:            name.trim(),
    color:           color || '#6B7A8D',
    dbPath:          path.join(dir, `neurologue-${id}.db`),
    vectorStorePath: path.join(dir, `vector-store-${id}`),
    createdAt:       new Date().toISOString(),
  };

  manifest.profiles.push(profile);
  _saveManifest(manifest);
  return profile;
}

/**
 * Rename an existing profile.
 * @param {string} id
 * @param {string} name
 */
function renameProfile(id, name) {
  if (!name || !name.trim()) throw new Error('Profile name is required');
  const manifest = _loadManifest();
  const profile  = manifest.profiles.find((p) => p.id === id);
  if (!profile) throw new Error(`Profile ${id} not found`);
  profile.name = name.trim();
  _saveManifest(manifest);
  return profile;
}

/**
 * Delete a profile.  Cannot delete the active profile or the last remaining one.
 * @param {string} id
 */
function deleteProfile(id) {
  const manifest = _loadManifest();
  if (id === manifest.activeId)       throw new Error('Cannot delete the active profile — switch first');
  if (manifest.profiles.length <= 1)  throw new Error('Cannot delete the only profile');
  manifest.profiles = manifest.profiles.filter((p) => p.id !== id);
  _saveManifest(manifest);
  return { ok: true };
}

/**
 * Mark a profile as the active one and return it.
 * @param {string} id
 */
function setActiveProfile(id) {
  const manifest = _loadManifest();
  const profile  = manifest.profiles.find((p) => p.id === id);
  if (!profile) throw new Error(`Profile ${id} not found`);
  manifest.activeId = id;
  _saveManifest(manifest);
  return profile;
}

module.exports = {
  listProfiles,
  getActiveProfile,
  createProfile,
  renameProfile,
  deleteProfile,
  setActiveProfile,
};
