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

/**
 * Free-text chat grounded in the user's corpus.
 * Retrieves relevant entries + theme summaries as system context, then streams
 * a multi-turn response via /api/chat.
 *
 * @param {string}   userMessage  The latest user message
 * @param {{ role: 'user'|'assistant', content: string }[]} history  Prior turns
 * @param {function} onToken      Called with each streamed text fragment
 * @returns {Promise<void>}
 */
async function chat(userMessage, history, onToken) {
  abortAgent(); // cancel any in-flight agent or chat

  const controller = new AbortController();
  _currentController = controller;

  try {
    const [contextEntries, themes] = await Promise.all([
      _buildChatContext(userMessage),
      listThemes().catch(() => []),
    ]);

    const systemContent = _buildSystemMessage(contextEntries, themes.slice(0, 3));

    const messages = [
      { role: 'system', content: systemContent },
      ...history,
      { role: 'user', content: userMessage },
    ];

    await chatStream(messages, onToken, 180_000, controller.signal);
  } finally {
    if (_currentController === controller) _currentController = null;
  }
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

module.exports = { listAgents, runAgent, abortAgent, chat };
