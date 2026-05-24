'use strict';

/**
 * Agent definitions and runner for Agentic Extensions (issue #59).
 *
 * Each agent:
 *   1. Gathers structured context from the corpus via backend/db/agents.js
 *   2. Builds an Ollama prompt
 *   3. Streams the LLM response token-by-token via generateStream()
 */

const {
  getWeekSummaryData,
  getOpenTasksData,
  getEmergingPrioritiesData,
  getTodayFocusData,
} = require('../db/agents');

const { generateStream, chatStream, generateEmbedding, isOllamaAvailable } = require('../../worker/ollama');
const { searchNearest } = require('../vector/store');
const { searchEntriesText, getEntryWithTags } = require('../db/search');
const { listThemes } = require('../db/themes');
const { createEntry } = require('../db/entries');

// ── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = {
  'week-summary': {
    label:       'Summarise my week',
    description: 'A narrative summary of everything you captured in the last 7 days.',
    icon:        '📅',
    async buildPrompt() {
      const { entries, since } = await getWeekSummaryData();
      if (entries.length === 0) {
        return `You have no notes captured since ${since}. Nothing to summarise yet.`;
      }
      const lines = entries.map((e) => {
        const date = e.created_at.slice(0, 10);
        const cat  = e.category ? ` [${e.category}]` : '';
        return `- ${date}${cat}: ${e.content.slice(0, 300)}`;
      }).join('\n');

      return (
        `Here are all the notes I captured over the past 7 days (since ${since}):\n\n${lines}\n\n` +
        'Write a concise, thoughtful summary (3-5 paragraphs) of what I was thinking about this week. ' +
        'Identify key themes, any notable ideas or decisions, and patterns you notice. ' +
        'Write in second person (e.g. "You spent time thinking about...", "A recurring theme was...").'
      );
    },
  },

  'open-tasks': {
    label:       'Find open tasks',
    description: 'All task-type notes, organised by apparent urgency.',
    icon:        '✅',
    async buildPrompt() {
      const { tasks } = await getOpenTasksData();
      if (tasks.length === 0) {
        return 'There are no task-type notes in your library yet.';
      }
      const lines = tasks.map((t) => {
        const date = t.created_at.slice(0, 10);
        return `- (${date}) ${t.content.slice(0, 300)}`;
      }).join('\n');

      return (
        `Here are all task-type notes from my knowledge library:\n\n${lines}\n\n` +
        'Identify which tasks appear to be unresolved based on their wording. ' +
        'Group them by theme or area if patterns emerge. ' +
        'Note any that seem time-sensitive or high-priority. ' +
        'Present the output as a clear, organised list.'
      );
    },
  },

  'emerging-priorities': {
    label:       'Identify emerging priorities',
    description: 'Themes gaining momentum in your recent captures.',
    icon:        '📈',
    async buildPrompt() {
      const { themes, since } = await getEmergingPrioritiesData();
      if (themes.length === 0) {
        return 'Not enough theme activity to identify emerging priorities yet. Capture more notes and run clustering to build up your theme library.';
      }
      const lines = themes.map((t) => {
        const trend =
          t.recent_count > t.prev_count ? '↑ growing' :
          t.recent_count < t.prev_count ? '↓ fading'  : '→ stable';
        return `- "${t.display_name}": ${t.recent_count} entries this week, ${t.prev_count} the week before (${trend})`;
      }).join('\n');

      return (
        `Here is the theme activity data from my knowledge library for the past two weeks (since ${since}):\n\n${lines}\n\n` +
        'Based on this data, identify which themes are emerging as priorities. ' +
        'Explain what the trends suggest about my current focus. ' +
        'Highlight anything that seems to be gaining urgency or drifting away. ' +
        'Write in second person.'
      );
    },
  },

  'focus-today': {
    label:       'Suggest focus areas for today',
    description: 'Personalised suggestions for where to direct your attention today.',
    icon:        '🎯',
    async buildPrompt() {
      const { recentEntries, openTasks, topThemes } = await getTodayFocusData();

      const parts = [];

      if (topThemes.length > 0) {
        parts.push(
          'Active themes this week:\n' +
          topThemes.map((t) => `- "${t.display_name}" (${t.recent_count} recent entries)`).join('\n')
        );
      }

      if (openTasks.length > 0) {
        parts.push(
          'Open tasks:\n' +
          openTasks.slice(0, 10).map((t) => `- ${t.content.slice(0, 200)}`).join('\n')
        );
      }

      if (recentEntries.length > 0) {
        parts.push(
          'Recent captures:\n' +
          recentEntries.slice(0, 15).map((e) => {
            const cat = e.category ? ` [${e.category}]` : '';
            return `- ${e.created_at.slice(0, 10)}${cat}: ${e.content.slice(0, 200)}`;
          }).join('\n')
        );
      }

      if (parts.length === 0) {
        return 'Not enough recent data to suggest focus areas. Start by capturing some notes.';
      }

      return (
        parts.join('\n\n') + '\n\n' +
        'Based on this context from my knowledge library, suggest 3-5 specific focus areas for today. ' +
        'For each suggestion, give a one-sentence rationale grounded in the data above. ' +
        'Be concrete and actionable. Write in second person.'
      );
    },
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the list of available agents.
 * @returns {{ id: string, label: string, description: string, icon: string }[]}
 */
function listAgents() {
  return Object.entries(AGENTS).map(([id, a]) => ({
    id,
    label:       a.label,
    description: a.description,
    icon:        a.icon,
  }));
}

// AbortController for the currently-running HTTP stream
let _currentController = null;

/**
 * Abort the currently-running agent stream immediately.
 */
function abortAgent() {
  if (_currentController) {
    _currentController.abort();
    _currentController = null;
  }
}

/**
 * Run an agent, streaming the LLM response token-by-token.
 * Aborts any in-flight run before starting a new one.
 * @param {string}   agentId
 * @param {function} onToken  Called with each text fragment as it arrives
 * @returns {Promise<void>}
 */
async function runAgent(agentId, onToken) {
  const agent = AGENTS[agentId];
  if (!agent) throw new Error(`Unknown agent: "${agentId}"`);

  // Cancel any previous stream before starting fresh
  abortAgent();

  const controller = new AbortController();
  _currentController = controller;

  try {
    const prompt = await agent.buildPrompt();
    await generateStream(prompt, onToken, 180_000, controller.signal);
  } finally {
    if (_currentController === controller) _currentController = null;
  }
}

// ── Chat ─────────────────────────────────────────────────────────────────────

// Pending destructive action waiting for user confirmation
let _pendingConfirmation = null;

/**
 * Classify a user message into one of: create | search | summarise | edit | general
 * @param {string} message
 * @returns {Promise<string>}
 */
async function detectIntent(message) {
  const prompt =
    `Classify this message into exactly one intent word.\n` +
    `Valid intents: create, search, summarise, edit, general\n\n` +
    `- "create": save/add/record a new note\n` +
    `- "search": find existing notes\n` +
    `- "summarise": summarise notes on a topic\n` +
    `- "edit": modify or delete an existing note\n` +
    `- "general": a question, conversation, or anything else\n\n` +
    `Message: "${message.slice(0, 300)}"\n\n` +
    `Intent (one word only):`;

  let result = '';
  try {
    await generateStream(prompt, (t) => { result += t; }, 15_000);
  } catch { /* default to general */ }

  result = result.trim().toLowerCase().split(/\s+/)[0] || 'general';
  const valid = ['create', 'search', 'summarise', 'edit', 'general'];
  return valid.includes(result) ? result : 'general';
}

function _extractCreateContent(message) {
  return message
    .replace(/^(create\s+a?\s*note\s*[:—\-]?\s*|add\s+(?:a\s+)?note\s*[:—\-]?\s*|save\s+(?:a?\s*note\s*[:—\-]?\s*|this\s*[:—\-]?\s*)|record\s*[:—\-]?\s*|note\s*[:—\-]\s*)/i, '')
    .trim();
}

/**
 * Free-text chat with corpus grounding and agentic note management.
 * Detects intent and dispatches: create → save entry; search → find entries;
 * summarise → LLM synthesis; general → context-grounded chatStream.
 *
 * @param {string}   userMessage
 * @param {{ role: 'user'|'assistant', content: string }[]} history
 * @param {function} onToken    Called with each text fragment
 * @param {function} [onAction] Called with { type, ... } on corpus mutations
 * @returns {Promise<void>}
 */
async function chat(userMessage, history, onToken, onAction = null) {
  abortAgent();

  // Resolve any pending confirmation before normal dispatch
  if (_pendingConfirmation) {
    const confirmed = /^yes\b/i.test(userMessage.trim());
    const pending   = _pendingConfirmation;
    _pendingConfirmation = null;
    if (confirmed) {
      onToken(`Action confirmed — "${pending.type}" via chat is not yet fully implemented.`);
    } else {
      onToken('Action cancelled.');
    }
    return;
  }

  // Detect intent (falls back to general if Ollama unavailable or detection fails)
  let intent = 'general';
  try {
    if (await isOllamaAvailable()) intent = await detectIntent(userMessage);
  } catch { /* keep general */ }

  // ── Non-streaming intents ────────────────────────────────────────────────
  if (intent === 'create') {
    await _handleCreate(userMessage, onToken, onAction);
    return;
  }

  if (intent === 'search') {
    await _handleSearch(userMessage, onToken);
    return;
  }

  if (intent === 'edit') {
    _pendingConfirmation = { type: 'edit' };
    onToken('Editing notes via chat requires confirmation and is not yet fully implemented. Reply "yes" to acknowledge, or continue with another request.');
    return;
  }

  // ── Streaming intents (summarise + general) ──────────────────────────────
  const controller = new AbortController();
  _currentController = controller;

  try {
    if (intent === 'summarise') {
      await _handleSummarise(userMessage, onToken, controller.signal);
      return;
    }

    // General: context-grounded multi-turn chat
    const [contextEntries, themes] = await Promise.all([
      _buildChatContext(userMessage),
      listThemes().catch(() => []),
    ]);

    const messages = [
      { role: 'system', content: _buildSystemMessage(contextEntries, themes.slice(0, 3)) },
      ...history,
      { role: 'user', content: userMessage },
    ];

    await chatStream(messages, onToken, 180_000, controller.signal);
  } finally {
    if (_currentController === controller) _currentController = null;
  }
}

async function _handleCreate(userMessage, onToken, onAction) {
  const content = _extractCreateContent(userMessage);
  if (!content) {
    onToken('I couldn\'t find note content to save. Try: "Create a note: your text here"');
    return;
  }
  const entry = await createEntry({ content, source: 'chat' });
  if (onAction) onAction({ type: 'entry-created', entryId: entry.id });
  onToken(`Created 1 new note:\n"${content.slice(0, 120)}${content.length > 120 ? '…' : ''}"`);
}

async function _handleSearch(userMessage, onToken) {
  const query = userMessage
    .replace(/^(find\s+(?:notes?\s+)?(?:about|on|for)?|search\s+(?:for\s+)?(?:notes?\s+)?(?:about|on)?|look\s+(?:up|for)\s+(?:notes?\s+)?(?:about|on)?|show\s+(?:me\s+)?(?:notes?\s+)?(?:about|on|for)?)\s*/i, '')
    .trim() || userMessage;

  const [textResults, semanticEntries] = await Promise.all([
    searchEntriesText(query, { limit: 8 }).catch(() => []),
    _buildChatContext(query),
  ]);

  const seen = new Set();
  const entries = [];
  for (const e of [...semanticEntries, ...textResults]) {
    if (!seen.has(e.id)) { seen.add(e.id); entries.push(e); }
  }

  if (entries.length === 0) {
    onToken(`No notes found matching "${query}".`);
    return;
  }

  const lines = entries.slice(0, 8).map((e) => {
    const date = e.created_at ? e.created_at.slice(0, 10) : '';
    const cat  = e.category ? ` [${e.category}]` : '';
    return `• ${date}${cat}: ${e.content.slice(0, 150)}${e.content.length > 150 ? '…' : ''}`;
  });

  onToken(`Found ${entries.length} note${entries.length !== 1 ? 's' : ''} matching "${query}":\n\n${lines.join('\n')}`);
}

async function _handleSummarise(userMessage, onToken, signal) {
  const topic = userMessage
    .replace(/^(summari[sz]e?\s+(?:my\s+)?(?:notes?\s+)?(?:on|about)?|give\s+me\s+a\s+summary\s+of(?:\s+my\s+notes?\s+on)?|what\s+(?:do\s+I\s+know|have\s+I\s+(?:written|noted|said))\s+about)\s*/i, '')
    .replace(/\s+(notes?|entries?|thoughts?)$/i, '')
    .trim() || userMessage;

  const contextEntries = await _buildChatContext(topic);

  if (contextEntries.length === 0) {
    onToken(`No notes found on "${topic}" to summarise.`);
    return;
  }

  const entryLines = contextEntries.map((e) => {
    const date = e.created_at ? e.created_at.slice(0, 10) : '';
    return `- ${date}: ${e.content.slice(0, 300)}`;
  }).join('\n');

  const prompt =
    `Here are notes from my knowledge base on the topic "${topic}":\n\n${entryLines}\n\n` +
    `Write a concise summary (2–3 paragraphs) of what these notes reveal about this topic. ` +
    `Identify key ideas, any patterns or tensions, and what they collectively suggest. ` +
    `Write in second person.`;

  await generateStream(prompt, onToken, 120_000, signal);
}

async function _buildChatContext(query) {
  let entries = [];

  // Prefer semantic search when Ollama is available
  try {
    if (await isOllamaAvailable()) {
      const queryVector = await generateEmbedding(query);
      const hits = await searchNearest(queryVector, 5);
      entries = (await Promise.all(hits.map((h) => getEntryWithTags(h.entry_id)))).filter(Boolean);
    }
  } catch { /* fall through to text search */ }

  // Supplement with text search if semantic returned too few results
  if (entries.length < 3) {
    try {
      const textResults = await searchEntriesText(query, { limit: 5 });
      const seen = new Set(entries.map((e) => e.id));
      for (const e of textResults) {
        if (!seen.has(e.id)) entries.push(e);
      }
    } catch { /* ignore */ }
  }

  return entries.slice(0, 5);
}

function _buildSystemMessage(entries, themes) {
  const parts = [
    'You are a helpful assistant for a personal knowledge base called Neurologue. ' +
    'Answer questions grounded in the notes and themes below. ' +
    'Be concise and refer to specific notes when relevant.',
  ];

  if (entries.length > 0) {
    parts.push('\nRelevant notes:');
    for (const e of entries) {
      const date = e.created_at ? e.created_at.slice(0, 10) : '';
      const cat  = e.category ? ` [${e.category}]` : '';
      parts.push(`- ${date}${cat}: ${e.content.slice(0, 300)}`);
    }
  }

  if (themes.length > 0) {
    parts.push('\nActive themes:');
    for (const t of themes) {
      const desc = t.description ? ` — ${t.description.slice(0, 120)}` : '';
      parts.push(`- "${t.display_name}"${desc}`);
    }
  }

  if (entries.length === 0 && themes.length === 0) {
    parts.push('\nThe knowledge base is empty. Let the user know they can start by capturing notes.');
  }

  return parts.join('\n');
}

module.exports = { listAgents, runAgent, abortAgent, chat, detectIntent };
