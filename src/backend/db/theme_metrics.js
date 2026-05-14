'use strict';

const { randomUUID } = require('crypto');
const { openDb } = require('./connection');

// ── EVOM weights (from priority-model.md) ─────────────────────────────────

const W_ENERGY      = { frequency: 0.35, recency: 0.25, length: 0.20, intensity: 0.20 };
const W_VALUE       = { stability: 0.50, positive: 0.25, value_ref: 0.25 };
const W_OBLIGATION  = { obligation: 0.50, open_loop: 0.30, deadline: 0.20 };
const W_MOTIVATION  = { motivation: 0.50, pos_sentiment: 0.25, recurrence: 0.25 };
const W_PRIORITY    = { energy: 0.35, value: 0.25, obligation: 0.25, motivation: 0.15 };

/**
 * Compute and persist ThemeMetrics for all themes using current entry_signals data.
 * Uses the last 30 days as the default window.
 * @returns {Promise<number>} Number of themes updated
 */
async function recomputeAllThemeMetrics() {
  const db = await openDb();
  const themes = db.prepare('SELECT id FROM themes').all();
  const now = new Date();
  const windowEnd   = now.toISOString();
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  let updated = 0;
  for (const { id: themeId } of themes) {
    try {
      await _computeAndStore(db, themeId, windowStart, windowEnd);
      updated++;
    } catch (err) {
      console.warn(`[theme_metrics] Failed for theme ${themeId}: ${err.message}`);
    }
  }
  return updated;
}

async function _computeAndStore(db, themeId, windowStart, windowEnd) {
  // Get all entry signals for entries in this theme within the window
  const signals = db.prepare(`
    SELECT es.*, e.created_at
    FROM entry_signals es
    JOIN entries e ON e.id = es.entry_id
    WHERE es.theme_id = ?
      AND e.created_at >= ?
      AND e.created_at <= ?
  `).all(themeId, windowStart, windowEnd);

  const entriesCount = signals.length;
  if (entriesCount === 0) {
    await upsertThemeMetrics({
      theme_id: themeId, window_start: windowStart, window_end: windowEnd,
      energy_score: 0, value_alignment_score: 0, obligation_score: 0,
      motivation_score: 0, priority_score: 0, open_loops_count: 0, entries_count: 0,
    });
    return;
  }

  const now = Date.now();
  const windowMs = new Date(windowEnd).getTime() - new Date(windowStart).getTime();

  // Energy: frequency + recency + avg length + avg emotional_intensity
  const frequency       = Math.min(1, entriesCount / 20); // normalise to ~20 entries = 1.0
  const avgRecency      = signals.reduce((sum, s) => {
    const age = now - new Date(s.created_at).getTime();
    return sum + Math.max(0, 1 - age / windowMs);
  }, 0) / entriesCount;
  const avgLength       = Math.min(1, signals.reduce((s, r) => s + (r.length_tokens || 0), 0) / (entriesCount * 200));
  const avgIntensity    = signals.reduce((s, r) => s + r.emotional_intensity, 0) / entriesCount;
  const energyScore     = W_ENERGY.frequency * frequency
                        + W_ENERGY.recency   * avgRecency
                        + W_ENERGY.length    * avgLength
                        + W_ENERGY.intensity * avgIntensity;

  // Value alignment: stability (proxy: 1 if > 1 entry) + pos sentiment ratio + value_ref ratio
  const stability        = entriesCount > 1 ? 1 : 0.5;
  const posRatio         = signals.filter((s) => s.sentiment_score > 0).length / entriesCount;
  const valueRefRatio    = signals.filter((s) => s.value_reference_flag).length / entriesCount;
  const valueScore       = W_VALUE.stability  * stability
                         + W_VALUE.positive   * posRatio
                         + W_VALUE.value_ref  * valueRefRatio;

  // Obligation
  const obligationRatio  = signals.filter((s) => s.obligation_flag).length / entriesCount;
  const openLoopCount    = signals.filter((s) => s.open_loop_flag).length;
  const openLoopRatio    = openLoopCount / entriesCount;
  const obligationScore  = W_OBLIGATION.obligation * obligationRatio
                         + W_OBLIGATION.open_loop  * openLoopRatio;
  // (deadline component not yet available — stays at 0)

  // Motivation
  const motivationRatio  = signals.filter((s) => s.motivation_flag).length / entriesCount;
  const posSentStrength  = signals.filter((s) => s.sentiment_score > 0)
    .reduce((s, r) => s + r.sentiment_score, 0) / Math.max(1, signals.filter((s) => s.sentiment_score > 0).length);
  // recurrence: proxy — if there are entries spread across multiple days, score higher
  const days = new Set(signals.map((s) => s.created_at.slice(0, 10))).size;
  const recurrence       = Math.min(1, days / 7);
  const motivationScore  = W_MOTIVATION.motivation     * motivationRatio
                         + W_MOTIVATION.pos_sentiment  * posSentStrength
                         + W_MOTIVATION.recurrence     * recurrence;

  // Priority
  const priorityScore    = W_PRIORITY.energy     * energyScore
                         + W_PRIORITY.value       * valueScore
                         + W_PRIORITY.obligation  * obligationScore
                         + W_PRIORITY.motivation  * motivationScore;

  await upsertThemeMetrics({
    theme_id: themeId, window_start: windowStart, window_end: windowEnd,
    energy_score:          Math.min(1, Math.max(0, energyScore)),
    value_alignment_score: Math.min(1, Math.max(0, valueScore)),
    obligation_score:      Math.min(1, Math.max(0, obligationScore)),
    motivation_score:      Math.min(1, Math.max(0, motivationScore)),
    priority_score:        Math.min(1, Math.max(0, priorityScore)),
    open_loops_count:      openLoopCount,
    entries_count:         entriesCount,
  });
}

/**
 * Write (upsert) a ThemeMetrics row for a given theme + time window.
 * If a row already exists for (theme_id, window_start, window_end) it is replaced.
 *
 * @param {{
 *   theme_id: string,
 *   window_start: string,   ISO datetime
 *   window_end: string,     ISO datetime
 *   energy_score: number,
 *   value_alignment_score: number,
 *   obligation_score: number,
 *   motivation_score: number,
 *   priority_score: number,
 *   open_loops_count: number,
 *   entries_count: number,
 * }} metrics
 * @returns {object} The inserted/replaced row
 */
async function upsertThemeMetrics(metrics) {
  const db = await openDb();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO theme_metrics
      (id, theme_id, window_start, window_end,
       energy_score, value_alignment_score, obligation_score,
       motivation_score, priority_score, open_loops_count, entries_count, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(theme_id, window_start, window_end) DO UPDATE SET
      energy_score          = excluded.energy_score,
      value_alignment_score = excluded.value_alignment_score,
      obligation_score      = excluded.obligation_score,
      motivation_score      = excluded.motivation_score,
      priority_score        = excluded.priority_score,
      open_loops_count      = excluded.open_loops_count,
      entries_count         = excluded.entries_count,
      computed_at           = excluded.computed_at
  `).run(
    id,
    metrics.theme_id,
    metrics.window_start,
    metrics.window_end,
    metrics.energy_score          ?? 0,
    metrics.value_alignment_score ?? 0,
    metrics.obligation_score      ?? 0,
    metrics.motivation_score      ?? 0,
    metrics.priority_score        ?? 0,
    metrics.open_loops_count      ?? 0,
    metrics.entries_count         ?? 0,
  );
  return db.prepare('SELECT * FROM theme_metrics WHERE theme_id = ? AND window_start = ? AND window_end = ?')
    .get(metrics.theme_id, metrics.window_start, metrics.window_end);
}

/**
 * Get the most recent ThemeMetrics row for each theme.
 * @returns {object[]}
 */
async function listLatestThemeMetrics() {
  const db = await openDb();
  return db.prepare(`
    SELECT tm.*
    FROM theme_metrics tm
    INNER JOIN (
      SELECT theme_id, MAX(computed_at) AS latest
      FROM theme_metrics
      GROUP BY theme_id
    ) recent ON tm.theme_id = recent.theme_id AND tm.computed_at = recent.latest
    ORDER BY tm.priority_score DESC
  `).all();
}

/**
 * Get all ThemeMetrics rows for a specific theme, ordered by window_start.
 * @param {string} themeId
 * @returns {object[]}
 */
async function getThemeMetricsHistory(themeId) {
  const db = await openDb();
  return db.prepare(
    'SELECT * FROM theme_metrics WHERE theme_id = ? ORDER BY window_start ASC'
  ).all(themeId);
}

/**
 * Get the latest ThemeMetrics row for a specific theme.
 * @param {string} themeId
 * @returns {object|undefined}
 */
async function getLatestThemeMetrics(themeId) {
  const db = await openDb();
  return db.prepare(
    'SELECT * FROM theme_metrics WHERE theme_id = ? ORDER BY computed_at DESC LIMIT 1'
  ).get(themeId);
}

/**
 * Classify the drift direction for a single theme based on its last two metric snapshots.
 * Returns 'rising' | 'falling' | 'neglected' | 'stable'
 *
 * neglected = high obligation (>0.5) with low or falling energy
 * rising    = energy or priority improved by >0.05 since last snapshot
 * falling   = energy or priority dropped by >0.05 since last snapshot
 * stable    = change within ±0.05
 *
 * @param {string} themeId
 * @returns {Promise<string>}
 */
async function getDriftClassification(themeId) {
  const db = await openDb();
  const rows = db.prepare(
    'SELECT * FROM theme_metrics WHERE theme_id = ? ORDER BY window_end DESC LIMIT 2'
  ).all(themeId);

  const latest = rows[0];
  if (!latest) return 'stable';

  // Neglected: high obligation with low or falling energy
  if (latest.obligation_score > 0.5 && latest.energy_score < 0.3) return 'neglected';

  if (rows.length < 2) return 'stable';
  const prev = rows[1];
  const dE = latest.energy_score   - prev.energy_score;
  const dP = latest.priority_score - prev.priority_score;
  if (latest.obligation_score > 0.5 && dE < -0.05) return 'neglected';
  if (dE > 0.05 || dP > 0.05)  return 'rising';
  if (dE < -0.05 || dP < -0.05) return 'falling';
  return 'stable';
}

/**
 * Return latest metrics for all themes augmented with a drift classification
 * and an energy history array for sparkline rendering.
 * @returns {Promise<Array>}
 */
async function listThemesWithDrift() {
  const db = await openDb();
  const latest = await listLatestThemeMetrics();
  return Promise.all(latest.map(async (m) => {
    const drift = await getDriftClassification(m.theme_id);
    // Last 8 snapshots for sparkline (oldest → newest)
    const history = db.prepare(
      'SELECT energy_score, priority_score, computed_at FROM theme_metrics WHERE theme_id = ? ORDER BY computed_at ASC LIMIT 8'
    ).all(m.theme_id);
    return { ...m, drift, history };
  }));
}

module.exports = {
  upsertThemeMetrics,
  listLatestThemeMetrics,
  getThemeMetricsHistory,
  getLatestThemeMetrics,
  recomputeAllThemeMetrics,
  getDriftClassification,
  listThemesWithDrift,
};
