'use strict';

/**
 * sql.js-backed SQLite connection with a better-sqlite3-compatible API.
 *
 * sql.js uses WebAssembly — no native compilation required.
 * The DB is kept in memory and flushed to disk after each committed write.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const config = require('../../config');

let _wrappedDb = null;
let _dbPathOverride = null;

/**
 * Override the DB path used by openDb().
 * Call before openDb() or use switchDb() to replace a live connection.
 * @param {string|null} dbPath
 */
function setDbPath(dbPath) {
  _dbPathOverride = dbPath || null;
}

/**
 * Close the current DB connection and reopen at a new path.
 * Used by portfolio switching.
 * @param {string} newPath
 */
async function switchDb(newPath) {
  if (_wrappedDb) _wrappedDb.close(); // close() sets _wrappedDb = null
  _dbPathOverride = newPath;
  return openDb();
}

// ---------------------------------------------------------------------------
// Parameter normalisation
// ---------------------------------------------------------------------------

/**
 * Accept either spread args  → run(a, b, c)
 * or a single array          → run([a, b, c])
 */
function normaliseParams(params) {
  if (params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

// ---------------------------------------------------------------------------
// SqlJsDb — thin wrapper that exposes a better-sqlite3-compatible interface
// ---------------------------------------------------------------------------

class SqlJsDb {
  constructor(rawDb, dbPath) {
    this._db = rawDb;
    this._path = dbPath;
    this._inTransaction = false;
  }

  /** Serialise the in-memory DB and write it to disk. */
  _save() {
    if (!this._db) return;
    const data = this._db.export();
    const dir = path.dirname(this._path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._path, Buffer.from(data));
  }

  /** Execute one or more SQL statements (no parameters). Saves unless inside a transaction. */
  exec(sql) {
    this._db.exec(sql);
    if (!this._inTransaction) this._save();
    return this;
  }

  pragma(pragmaStr) {
    this._db.run(`PRAGMA ${pragmaStr}`);
    return this;
  }

  /**
   * Prepare a SQL statement and return an object with run / get / all methods,
   * mirroring the better-sqlite3 Statement API.
   */
  prepare(sql) {
    const self = this;
    const rawDb = this._db;

    return {
      run(...params) {
        const p = normaliseParams(params);
        if (p.length > 0) {
          rawDb.run(sql, p);
        } else {
          rawDb.run(sql);
        }
        if (!self._inTransaction) self._save();
        return { changes: rawDb.getRowsModified() };
      },

      get(...params) {
        const p = normaliseParams(params);
        const stmt = rawDb.prepare(sql);
        if (p.length > 0) stmt.bind(p);
        const result = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return result;
      },

      all(...params) {
        const p = normaliseParams(params);
        const stmt = rawDb.prepare(sql);
        if (p.length > 0) stmt.bind(p);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      },
    };
  }

  /**
   * Wrap a synchronous function in a BEGIN / COMMIT transaction.
   * Saves to disk after COMMIT. Rolls back on error.
   * Returns a callable that accepts the same args as fn.
   */
  transaction(fn) {
    const self = this;
    return (...args) => {
      self._inTransaction = true;
      self._db.run('BEGIN');
      try {
        const result = fn(...args);
        self._db.run('COMMIT');
        self._save();
        return result;
      } catch (e) {
        self._db.run('ROLLBACK');
        throw e;
      } finally {
        self._inTransaction = false;
      }
    };
  }

  close() {
    if (this._db) {
      this._save();
      this._db.close();
      this._db = null;
    }
    _wrappedDb = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function openDb() {
  if (_wrappedDb) return _wrappedDb;

  const dbPath = _dbPathOverride || config.db.path;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
  });

  let rawDb;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  _wrappedDb = new SqlJsDb(rawDb, dbPath);
  _wrappedDb.pragma('foreign_keys = ON');
  return _wrappedDb;
}

function closeDb() {
  if (_wrappedDb) {
    _wrappedDb.close();
  }
}

module.exports = { openDb, closeDb, setDbPath, switchDb };
