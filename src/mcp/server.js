'use strict';

const http = require('http');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod/v4');
const { searchEntriesText, getEntryWithTags } = require('../backend/db/search');
const { listThemes, getThemeById } = require('../backend/db/themes');
const { createEntry } = require('../backend/db/entries');
const { setTagsForEntry } = require('../backend/db/tags');
const { searchNearest } = require('../backend/vector/store');
const { generateEmbedding, generateStream, isOllamaAvailable } = require('../worker/ollama');
const { runAgent } = require('../backend/agents/runner');

let _server = null;
let _running = false;
let _port = 3737;
let _token = '';

function _checkAuth(req) {
  if (!_token) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${_token}`;
}

function _readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : undefined); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/**
 * Create a McpServer instance with all tools registered.
 * Shared by both HTTP and stdio transports.
 * @returns {McpServer}
 */
function buildMcpServer() {
  const server = new McpServer({ name: 'neurologue', version: '0.10.3' });

  // ── Tool: search_notes ─────────────────────────────────────────────────────
  server.registerTool('search_notes', {
    description: 'Search notes by text and semantic similarity. Returns matching entries.',
    inputSchema: {
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (default 10)'),
    },
  }, async ({ query, limit = 10 }) => {
    const [textResults, semanticResults] = await Promise.all([
      searchEntriesText(query, { limit }),
      isOllamaAvailable().then(async (ok) => {
        if (!ok) return [];
        try {
          const vec = await generateEmbedding(query);
          const hits = await searchNearest(vec, limit);
          return Promise.all(hits.map(async (h) => {
            const entry = await getEntryWithTags(h.entry_id);
            return entry ? { ...entry, _distance: h._distance } : null;
          }));
        } catch { return []; }
      }),
    ]);

    const seen = new Set();
    const results = [];
    for (const e of [...textResults, ...(semanticResults.filter(Boolean))]) {
      if (e && !seen.has(e.id)) { seen.add(e.id); results.push(e); }
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'No notes found.' }] };
    }

    const lines = results.slice(0, limit).map((e) => {
      const tags = e.tags && e.tags.length ? ` [${e.tags.map((t) => t.name).join(', ')}]` : '';
      const date = e.created_at ? e.created_at.slice(0, 10) : '';
      return `- [${date}]${tags} ${e.content.slice(0, 200)}`;
    });
    return { content: [{ type: 'text', text: `Found ${results.length} note(s):\n${lines.join('\n')}` }] };
  });

  // ── Tool: list_themes ──────────────────────────────────────────────────────
  server.registerTool('list_themes', {
    description: 'List all detected themes with entry counts and descriptions.',
    inputSchema: {},
  }, async () => {
    const themes = await listThemes();
    if (!themes.length) {
      return { content: [{ type: 'text', text: 'No themes found. Run clustering first.' }] };
    }
    const lines = themes.map((t) => {
      const desc = t.description ? `: ${t.description.slice(0, 100)}` : '';
      return `- ${t.display_name} (${t.entry_count} entries)${desc}`;
    });
    return { content: [{ type: 'text', text: `Themes (${themes.length}):\n${lines.join('\n')}` }] };
  });

  // ── Tool: get_theme_entries ────────────────────────────────────────────────
  server.registerTool('get_theme_entries', {
    description: 'Get the notes belonging to a named theme.',
    inputSchema: {
      theme_name: z.string().describe('Theme name or partial match'),
      limit: z.number().optional().describe('Max entries to return (default 20)'),
    },
  }, async ({ theme_name, limit = 20 }) => {
    const themes = await listThemes();
    const match = themes.find((t) =>
      t.display_name.toLowerCase().includes(theme_name.toLowerCase())
    );
    if (!match) {
      return { content: [{ type: 'text', text: `No theme found matching "${theme_name}".` }] };
    }
    const full = await getThemeById(match.id);
    if (!full || !full.entries || full.entries.length === 0) {
      return { content: [{ type: 'text', text: `Theme "${match.display_name}" has no entries yet.` }] };
    }
    const lines = full.entries.slice(0, limit).map((e) => {
      const date = e.created_at ? e.created_at.slice(0, 10) : '';
      return `- [${date}] ${e.content.slice(0, 200)}`;
    });
    return { content: [{ type: 'text', text: `Theme: ${match.display_name}\n\n${lines.join('\n')}` }] };
  });

  // ── Tool: create_note ──────────────────────────────────────────────────────
  server.registerTool('create_note', {
    description: 'Create a new note in the corpus.',
    inputSchema: {
      content: z.string().describe('Note content'),
      tags: z.array(z.string()).optional().describe('Optional tags to apply'),
    },
  }, async ({ content, tags }) => {
    const entry = await createEntry({ content, source: 'mcp', type: 'note' });
    if (tags && tags.length > 0) {
      await setTagsForEntry(entry.id, tags);
    }
    return { content: [{ type: 'text', text: `Created note (id: ${entry.id}):\n${content}` }] };
  });

  // ── Tool: summarise_topic ──────────────────────────────────────────────────
  server.registerTool('summarise_topic', {
    description: 'Summarise corpus notes on a given topic using the local LLM.',
    inputSchema: {
      topic: z.string().describe('Topic or question to summarise'),
      limit: z.number().optional().describe('Number of relevant notes to use (default 5)'),
    },
  }, async ({ topic, limit = 5 }) => {
    const available = await isOllamaAvailable();
    if (!available) {
      return { content: [{ type: 'text', text: 'Ollama is not available. Please start Ollama and try again.' }] };
    }

    let entries = [];
    try {
      const vec = await generateEmbedding(topic);
      const hits = await searchNearest(vec, limit);
      entries = (await Promise.all(hits.map((h) => getEntryWithTags(h.entry_id)))).filter(Boolean);
    } catch { /* fall through */ }

    if (entries.length === 0) {
      entries = await searchEntriesText(topic, { limit });
    }
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: `No notes found on the topic "${topic}".` }] };
    }

    const context = entries.map((e, i) => `${i + 1}. ${e.content}`).join('\n\n');
    const prompt =
      `You are a helpful assistant for a personal knowledge base.\n\n` +
      `Summarise the following notes on the topic of "${topic}":\n\n` +
      `${context}\n\nProvide a concise summary.`;

    let summary = '';
    await generateStream(prompt, (token) => { summary += token; }, 60_000);
    return { content: [{ type: 'text', text: summary.trim() || 'Unable to generate summary.' }] };
  });

  // ── Tool: run_agent ────────────────────────────────────────────────────────
  server.registerTool('run_agent', {
    description: 'Run a Neurologue agent and return its full output. Available agents: daily-digest, weekly-review, monthly-themes.',
    inputSchema: {
      agent_id: z.string().describe('Agent ID (e.g. "daily-digest", "weekly-review", "monthly-themes")'),
    },
  }, async ({ agent_id }) => {
    const available = await isOllamaAvailable();
    if (!available) {
      return { content: [{ type: 'text', text: 'Ollama is not available. Please start Ollama and try again.' }] };
    }
    let output = '';
    try {
      await runAgent(agent_id, (token) => { output += token; });
    } catch (err) {
      return { content: [{ type: 'text', text: `Agent error: ${err.message}` }] };
    }
    return { content: [{ type: 'text', text: output.trim() || 'Agent produced no output.' }] };
  });

  return server;
}

async function _handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'neurologue-mcp' }));
    return;
  }

  if (req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }

  if (!_checkAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized.' }, id: null }));
    return;
  }

  let parsedBody;
  try {
    parsedBody = await _readBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error.' }, id: null }));
    return;
  }

  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    console.error('[MCP] Request error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error.' }, id: null }));
    }
  }
}

/**
 * Start the MCP HTTP server on the given port with bearer token auth.
 * @param {number} port
 * @param {string} token  Bearer token; empty string disables auth.
 * @returns {Promise<void>}
 */
function start(port, token) {
  return new Promise((resolve, reject) => {
    if (_running) { resolve(); return; }
    _port = port;
    _token = token;
    _server = http.createServer(_handleRequest);
    _server.on('error', (err) => {
      _running = false;
      _server = null;
      reject(err);
    });
    _server.listen(port, '127.0.0.1', () => {
      _running = true;
      console.log(`[MCP] Server listening on http://127.0.0.1:${port}/mcp`);
      resolve();
    });
  });
}

/**
 * Stop the MCP HTTP server.
 * @returns {Promise<void>}
 */
function stop() {
  return new Promise((resolve) => {
    if (!_server) { _running = false; resolve(); return; }
    _server.close(() => {
      _running = false;
      _server = null;
      console.log('[MCP] Server stopped');
      resolve();
    });
  });
}

function isRunning() { return _running; }

module.exports = { start, stop, isRunning, buildMcpServer };
