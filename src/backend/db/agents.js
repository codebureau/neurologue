'use strict';

/**
 * Data-gathering queries for the Agentic Extensions feature.
 * Each function assembles the corpus context that an agent prompt will use.
 */

const { openDb } = require('./connection');

const MAX_ENTRIES = 100;
const MAX_TASKS   = 200;

/**
 * Return entries captured in the last 7 days.
 * @returns {Promise<{ entries: object[], since: string }>}
 */
async function getWeekSummaryData() {
  const db    = await openDb();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const entries = db.prepare(
    `SELECT id, content, category, created_at
       FROM entries
      WHERE created_at >= ?
      ORDER BY created_at ASC
      LIMIT ?`
  ).all(since, MAX_ENTRIES);

  return { entries, since };
}

/**
 * Return all task-category entries (no explicit "done" state in the schema,
 * so we return all of them for the LLM to reason about).
 * @returns {Promise<{ tasks: object[] }>}
 */
async function getOpenTasksData() {
  const db = await openDb();

  const tasks = db.prepare(
    `SELECT id, content, created_at
       FROM entries
      WHERE category = 'Task'
      ORDER BY created_at DESC
      LIMIT ?`
  ).all(MAX_TASKS);

  return { tasks };
}

/**
 * Return theme activity for the last two weeks so the LLM can spot momentum.
 * @returns {Promise<{ themes: object[], since: string }>}
 */
async function getEmergingPrioritiesData() {
  const db          = await openDb();
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const oneWeekAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const themes = db.prepare(
    `SELECT t.id,
            COALESCE(t.user_name, t.name) AS display_name,
            COUNT(DISTINCT CASE WHEN e.created_at >= ? THEN e.id END)                      AS recent_count,
            COUNT(DISTINCT CASE WHEN e.created_at >= ? AND e.created_at < ? THEN e.id END) AS prev_count,
            COUNT(DISTINCT e.id) AS total_count
       FROM themes t
       JOIN theme_entries te ON te.theme_id = t.id
       JOIN entries e ON e.id = te.entry_id
      GROUP BY t.id
     HAVING total_count > 0
      ORDER BY recent_count DESC, total_count DESC
      LIMIT 20`
  ).all(oneWeekAgo, twoWeeksAgo, oneWeekAgo);

  return { themes, since: twoWeeksAgo };
}

/**
 * Return a mix of recent entries, open tasks, and active themes for a
 * "focus today" agent prompt.
 * @returns {Promise<{ recentEntries: object[], openTasks: object[], topThemes: object[] }>}
 */
async function getTodayFocusData() {
  const db         = await openDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const recentEntries = db.prepare(
    `SELECT id, content, category, created_at
       FROM entries
      WHERE created_at >= ?
      ORDER BY created_at DESC
      LIMIT 30`
  ).all(oneWeekAgo);

  const openTasks = db.prepare(
    `SELECT id, content, created_at
       FROM entries
      WHERE category = 'Task'
      ORDER BY created_at DESC
      LIMIT 20`
  ).all();

  const topThemes = db.prepare(
    `SELECT t.id,
            COALESCE(t.user_name, t.name) AS display_name,
            COUNT(e.id) AS recent_count
       FROM themes t
       JOIN theme_entries te ON te.theme_id = t.id
       JOIN entries e ON e.id = te.entry_id AND e.created_at >= ?
      GROUP BY t.id
      ORDER BY recent_count DESC
      LIMIT 10`
  ).all(oneWeekAgo);

  return { recentEntries, openTasks, topThemes };
}

module.exports = {
  getWeekSummaryData,
  getOpenTasksData,
  getEmergingPrioritiesData,
  getTodayFocusData,
};
