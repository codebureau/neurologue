'use strict';

/**
 * Stdio MCP entry point for Claude Desktop.
 * Claude Desktop launches this as a subprocess and communicates over stdin/stdout.
 *
 * Usage in claude_desktop_config.json:
 *   "command": "node",
 *   "args": ["<path-to-neurologue>/src/mcp/stdio.js"]
 */

const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { runMigrations } = require('../db/migrate');
const { initVectorStore, setStorePath } = require('../backend/vector/store');
const { getActiveProfile } = require('../backend/portfolio');
const { setDbPath } = require('../backend/db/connection');
const { buildMcpServer } = require('./server');

async function main() {
  // Initialise DB using the same active profile as the main app
  const profile = getActiveProfile();
  setDbPath(profile.dbPath);
  setStorePath(profile.vectorStorePath);
  await runMigrations();
  await initVectorStore();

  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[neurologue-mcp] Fatal: ${err.message}\n`);
  process.exit(1);
});
