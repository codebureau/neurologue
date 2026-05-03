'use strict';

/**
 * Shared test helper: open an isolated in-memory database for each test file.
 *
 * Usage:
 *   const { setupTestDb, teardownTestDb } = require('../helpers/db');
 *   beforeEach(setupTestDb);
 *   afterEach(teardownTestDb);
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Each test run gets its own temp directory so parallel suites never clash.
let tmpDir;

async function setupTestDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neurologue-test-'));
  process.env.NEUROLOGUE_DATA_PATH = tmpDir;

  // Clear the singleton so each test starts with a fresh connection.
  jest.resetModules();
}

async function teardownTestDb() {
  // Close the DB singleton if open.
  try {
    const { closeDb } = require('../../src/backend/db/connection');
    closeDb();
  } catch {
    // module may not have been loaded in this test
  }

  // Remove temp directory.
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  delete process.env.NEUROLOGUE_DATA_PATH;
}

module.exports = { setupTestDb, teardownTestDb };
