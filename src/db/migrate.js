'use strict';

const fs = require('fs');
const path = require('path');
const { openDb } = require('../backend/db/connection');

/**
 * Runs all pending SQL migrations from src/db/migrations/ in version order.
 * Tracks applied migrations in a `schema_migrations` table.
 */
async function runMigrations() {
  const db = await openDb();

  // Ensure migrations tracking table exists (standalone exec — saves immediately)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    })();

    console.log(`[migrate] Applied: ${file}`);
  }
}

module.exports = { runMigrations };
