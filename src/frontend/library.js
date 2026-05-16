'use strict';
/* global window, document */

// ── State ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;
let _state = {
  entries: [],
  offset: 0,
  hasMore: false,
  query: '',
  mode: 'text',      // 'text' | 'semantic'
  tagFilter: null,      // tag name string or null
  categoryFilter: null, // category string or null
  selectedId: null,
  groupBy: null,       // null | 'day' | 'week' | 'month'
  lastGroupKey: null,  // last rendered group separator key (for append)
};
let _loadingMore = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const btnText       = document.getElementById('btn-text');
const btnSemantic   = document.getElementById('btn-semantic');
const entryCount    = document.getElementById('entry-count');
const timelineList  = document.getElementById('timeline-list');
const loadMoreBtn   = document.getElementById('load-more-btn');
const tagList       = document.getElementById('tag-list');
const tagAll        = document.getElementById('tag-all');
const detailPlaceholder      = document.getElementById('detail-placeholder');
const detailContent          = document.getElementById('detail-content');
const detailDate    = document.getElementById('detail-date');
const detailSource  = document.getElementById('detail-source');
const detailCategoryBadge  = document.getElementById('detail-category-badge');
const detailCategorySelect = document.getElementById('detail-category-select');
const detailText      = document.getElementById('detail-text');
const detailTagsChips = document.getElementById('detail-tags-chips');
const detailTagsInput = document.getElementById('detail-tags-input');
const detailRead      = document.getElementById('detail-read');
const detailEdit    = document.getElementById('detail-edit');
const detailHistory = document.getElementById('detail-history');
const historyList   = document.getElementById('history-list');
const editTextarea  = document.getElementById('edit-textarea');
const editPreview   = document.getElementById('edit-preview');
const btnEditSave   = document.getElementById('btn-edit-save');
const btnEditCancel = document.getElementById('btn-edit-cancel');
const btnEdit       = document.getElementById('btn-edit');
const btnHistory    = document.getElementById('btn-history');
const detailFooterRead    = document.getElementById('detail-footer-read');
const detailFooterHistory = document.getElementById('detail-footer-history');
const exportBtn     = document.getElementById('btn-export');
const exportToast   = document.getElementById('export-toast');
const newNoteBtn    = document.getElementById('btn-new-note');
const helpBtn       = document.getElementById('btn-help');
const semanticNotice = document.getElementById('semantic-notice');
const statusOllama     = document.getElementById('status-ollama');
const statusWorker     = document.getElementById('status-worker');
const statusTask       = document.getElementById('status-task');
const statusErrorBadge = document.getElementById('status-error-badge');

// ── Timeline controls DOM refs ─────────────────────────────────────────────
const grpNoneBtn      = document.getElementById('grp-none');
const grpDayBtn       = document.getElementById('grp-day');
const grpWeekBtn      = document.getElementById('grp-week');
const grpMonthBtn     = document.getElementById('grp-month');
const heatmapToggle   = document.getElementById('btn-heatmap-toggle');
const heatmapPanel    = document.getElementById('heatmap-panel');
const heatmapGrid     = document.getElementById('heatmap-grid');
const heatmapMonths   = document.getElementById('heatmap-months');

// ── Filter DOM refs ────────────────────────────────────────────────────────
const filterBar    = document.getElementById('filter-bar');
const categoryList = document.getElementById('category-list');

// ── Graph DOM refs ─────────────────────────────────────────────────────────
const graphContainer   = document.getElementById('graph-container');
const graphNodeCount   = document.getElementById('graph-node-count');
const btnGraphRefresh  = document.getElementById('btn-graph-refresh');
const btnGraphReset    = document.getElementById('btn-graph-reset');

// ── Replay DOM refs ─────────────────────────────────────────────────────────
const replayMonthSelect    = document.getElementById('replay-month-select');
const replayMonthPh        = document.getElementById('replay-month-placeholder');
const replayMonthContent   = document.getElementById('replay-month-content');
const replayMonthHeading   = document.getElementById('replay-month-heading');
const replayMonthCount     = document.getElementById('replay-month-entry-count');
const replayMonthThemes    = document.getElementById('replay-month-themes');
const replayMonthEntries   = document.getElementById('replay-month-entries');
const replayCompareFrom1   = document.getElementById('replay-compare-from1');
const replayCompareTo1     = document.getElementById('replay-compare-to1');
const replayCompareFrom2   = document.getElementById('replay-compare-from2');
const replayCompareTo2     = document.getElementById('replay-compare-to2');
const btnReplayCompare     = document.getElementById('btn-replay-compare');
const replayComparePh      = document.getElementById('replay-compare-placeholder');
const replayCompareContent = document.getElementById('replay-compare-content');
const replayCompareLost    = document.getElementById('replay-compare-lost');
const replayCompareCommon  = document.getElementById('replay-compare-common');
const replayCompareGained  = document.getElementById('replay-compare-gained');
const replayAbandonedList  = document.getElementById('replay-abandoned-list');

// ── Utilities ──────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Render helpers ─────────────────────────────────────────────────────────

// Return a string key for grouping an entry by the current groupBy mode.
function _groupKey(entry, groupBy) {
  const d = new Date(entry.created_at);
  if (groupBy === 'day')   return d.toISOString().slice(0, 10);
  if (groupBy === 'month') return d.toISOString().slice(0, 7);
  if (groupBy === 'week') {
    // ISO week: use Thursday of the week to determine year, per ISO 8601
    const thu = new Date(d);
    thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
    const jan4 = new Date(thu.getFullYear(), 0, 4);
    const week = Math.ceil(((thu - jan4) / 86400000 + 1) / 7);
    return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return null;
}

// Return a human-readable label for a group key.
function _groupLabel(key, groupBy) {
  if (groupBy === 'day') {
    return new Date(key + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }
  if (groupBy === 'month') {
    const [year, month] = key.split('-');
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
      month: 'long', year: 'numeric',
    });
  }
  if (groupBy === 'week') {
    const [year, weekStr] = key.split('-W');
    // Compute the Monday of the ISO week
    const jan4  = new Date(Number(year), 0, 4);
    const mon   = new Date(jan4);
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (Number(weekStr) - 1) * 7);
    return `Week of ${mon.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  }
  return key;
}

function renderEntryCard(entry) {
  const card = document.createElement('div');
  card.className = 'entry-card' + (entry.id === _state.selectedId ? ' selected' : '');
  card.dataset.id = entry.id;

  const meta = document.createElement('div');
  meta.className = 'entry-meta';

  const date = document.createElement('span');
  date.className = 'entry-date';
  date.textContent = formatDate(entry.created_at);
  meta.appendChild(date);

  if (entry._distance !== undefined) {
    const score = document.createElement('span');
    score.className = 'entry-score';
    score.textContent = `${(1 - entry._distance).toFixed(2)} match`;
    meta.appendChild(score);
  }
  card.appendChild(meta);

  const preview = document.createElement('div');
  preview.className = 'entry-preview';
  preview.textContent = entry.content;
  card.appendChild(preview);

  const cat = entry.user_category || entry.category;
  const hasTags = entry.tags && entry.tags.length > 0;
  if (hasTags || cat) {
    const chipRow = document.createElement('div');
    chipRow.className = 'entry-chips';

    if (hasTags) {
      entry.tags.slice(0, 6).forEach((t) => {
        const pill = document.createElement('span');
        pill.className = 'tag-pill tag-pill--clickable';
        pill.textContent = `#${t.name || t}`;
        pill.title = `Filter by tag: ${t.name || t}`;
        pill.addEventListener('click', (e) => { e.stopPropagation(); applyTagFilter(t.name || t); });
        chipRow.appendChild(pill);
      });
    }

    if (cat) {
      const badge = document.createElement('span');
      badge.className = 'category-badge category-badge--card category-badge--clickable';
      badge.setAttribute('data-cat', cat);
      badge.textContent = cat;
      badge.title = `Filter by category: ${cat}`;
      badge.addEventListener('click', (e) => { e.stopPropagation(); applyCategoryFilter(cat); });
      chipRow.appendChild(badge);
    }

    card.appendChild(chipRow);
  }

  card.addEventListener('click', () => selectEntry(entry.id));
  return card;
}

function renderTimeline(entries, append = false) {
  if (!append) {
    timelineList.innerHTML = '';
    _state.lastGroupKey = null;
  }

  if (entries.length === 0 && !append) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = _state.query
      ? `<strong>No results</strong>Try a different search term`
      : `<strong>No entries yet</strong>Press Ctrl+Shift+Space to capture your first thought`;
    timelineList.appendChild(empty);
  } else {
    entries.forEach((e) => {
      if (_state.groupBy) {
        const key = _groupKey(e, _state.groupBy);
        if (key !== _state.lastGroupKey) {
          const header = document.createElement('div');
          header.className = 'tl-group-header';
          header.textContent = _groupLabel(key, _state.groupBy);
          timelineList.appendChild(header);
          _state.lastGroupKey = key;
        }
      }
      timelineList.appendChild(renderEntryCard(e));
    });
  }
}

function updateCount(total) {
  entryCount.textContent = total === 1 ? '1 entry' : `${total} entries`;
}

// ── Heatmap ────────────────────────────────────────────────────────────────

async function renderHeatmap() {
  heatmapGrid.innerHTML = '';
  heatmapMonths.innerHTML = '';

  const data = await window.neurologue.getActivity();
  const countMap = {};
  data.forEach(({ day, count }) => { countMap[day] = count; });

  // Build 52 columns ending with the week that contains today.
  // Anchoring to the *last* Sunday keeps today always in the final column,
  // regardless of what day of the week today falls on.
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - today.getDay()); // Sunday of this week

  const startDate = new Date(lastSunday);
  startDate.setDate(lastSunday.getDate() - 51 * 7);    // 52 weeks back

  const WEEK_PX = 12; // 10px cell + 2px gap
  let lastMonth = -1;
  const monthLabels = [];

  for (let w = 0; w < 52; w++) {
    const weekEl = document.createElement('div');
    weekEl.className = 'heatmap-week';

    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + w * 7 + d);

      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';

      if (cellDate <= today) {
        const key = cellDate.toISOString().slice(0, 10);
        const count = countMap[key] || 0;
        const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
        if (level > 0) cell.dataset.level = String(level);
        cell.title = `${key}: ${count} entr${count === 1 ? 'y' : 'ies'}`;

        if (d === 0 && cellDate.getMonth() !== lastMonth) {
          monthLabels.push({
            col: w,
            label: cellDate.toLocaleDateString(undefined, { month: 'short' }),
          });
          lastMonth = cellDate.getMonth();
        }
      }

      weekEl.appendChild(cell);
    }
    heatmapGrid.appendChild(weekEl);
  }

  // Render month labels using absolute positioning
  heatmapMonths.style.position = 'relative';
  monthLabels.forEach(({ col, label }) => {
    const span = document.createElement('span');
    span.textContent = label;
    span.style.position = 'absolute';
    span.style.left = `${col * WEEK_PX}px`;
    heatmapMonths.appendChild(span);
  });
}

// ── Data loading ───────────────────────────────────────────────────────────

async function loadEntries(append = false) {
  const offset = append ? _state.offset : 0;
  const { tagFilter: tag, categoryFilter: category, query } = _state;
  let entries = [];

  try {
    if (_state.mode === 'semantic' && query.trim()) {
      const result = await window.neurologue.searchSemantic(query);
      if (!result.ok) {
        semanticNotice.style.display = 'block';
        // Fall back to text search with active filters
        entries = await window.neurologue.searchText(query, { tag, category, limit: PAGE_SIZE, offset });
      } else {
        semanticNotice.style.display = 'none';
        // Post-filter semantic results by active tag/category (result set is small)
        entries = result.results.filter((e) => {
          if (tag && !((e.tags || []).some((t) => (t.name || t) === tag))) return false;
          if (category && (e.user_category || e.category) !== category) return false;
          return true;
        });
      }
      _state.hasMore = false;
      loadMoreBtn.style.display = 'none';
    } else if (query.trim() || tag || category) {
      entries = await window.neurologue.searchText(query, { tag, category, limit: PAGE_SIZE, offset });
      _state.hasMore = entries.length === PAGE_SIZE;
    } else {
      entries = await window.neurologue.list({ limit: PAGE_SIZE, offset });
      _state.hasMore = entries.length === PAGE_SIZE;
    }

    if (append) {
      _state.entries = [..._state.entries, ...entries];
    } else {
      _state.entries = entries;
      _state.offset = 0;
    }
    _state.offset += entries.length;

    renderTimeline(entries, append);
    updateCount(_state.entries.length + (_state.hasMore ? '+' : ''));
    loadMoreBtn.style.display = _state.hasMore ? 'block' : 'none';
  } catch (err) {
    console.error('[library] loadEntries failed:', err);
  }
}

async function loadTags() {
  try {
    const tags = await window.neurologue.listTags();
    tagList.innerHTML = '';
    tags.forEach((tag) => {
      const item = document.createElement('div');
      item.className = 'tag-item' + (tag.name === _state.tagFilter ? ' active' : '');
      item.innerHTML = `<span class="tag-name">${tag.name}</span><span class="tag-clear" title="Clear filter">✕</span>`;
      item.querySelector('.tag-name').addEventListener('click', () => applyTagFilter(tag.name));
      item.querySelector('.tag-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        applyTagFilter(null);
      });
      tagList.appendChild(item);
    });
  } catch (err) {
    console.error('[library] loadTags failed:', err);
  }
}

async function loadCategories() {
  try {
    const cats = await window.neurologue.listCategories();
    categoryList.innerHTML = '';
    if (!cats.length) return;
    cats.forEach(({ category, count }) => {
      const item = document.createElement('div');
      item.className = 'cat-item' + (category === _state.categoryFilter ? ' active' : '');
      item.dataset.cat = category;
      item.innerHTML = `<span class="cat-name">${category}</span>`
        + `<span class="cat-count">${count}</span>`
        + `<span class="tag-clear" title="Clear filter">✕</span>`;
      item.querySelector('.cat-name').addEventListener('click', () => applyCategoryFilter(category));
      item.querySelector('.cat-count').addEventListener('click', () => applyCategoryFilter(category));
      item.querySelector('.tag-clear').addEventListener('click', (e) => {
        e.stopPropagation();
        applyCategoryFilter(null);
      });
      categoryList.appendChild(item);
    });
  } catch (err) {
    console.error('[library] loadCategories failed:', err);
  }
}

function applyTagFilter(tagName) {
  _state.tagFilter = tagName;
  _state.selectedId = null;
  document.querySelectorAll('.tag-item').forEach((el) => {
    el.classList.toggle('active', el.querySelector('.tag-name').textContent === tagName);
  });
  renderActiveFilters();
  loadEntries();
  clearDetail();
}

function applyCategoryFilter(cat) {
  _state.categoryFilter = cat;
  _state.selectedId = null;
  document.querySelectorAll('.cat-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.cat === cat);
  });
  renderActiveFilters();
  loadEntries();
  clearDetail();
}

function renderActiveFilters() {
  filterBar.innerHTML = '';
  const hasTag = !!_state.tagFilter;
  const hasCat = !!_state.categoryFilter;

  if (!hasTag && !hasCat) {
    filterBar.classList.add('hidden');
    return;
  }
  filterBar.classList.remove('hidden');

  if (hasTag) {
    const pill = document.createElement('span');
    pill.className = 'active-filter-pill';
    pill.innerHTML = `<span class="afp-label">Tag: <strong>#${_state.tagFilter}</strong></span>`
      + `<button class="afp-remove" title="Clear tag filter">×</button>`;
    pill.querySelector('.afp-remove').addEventListener('click', () => applyTagFilter(null));
    filterBar.appendChild(pill);
  }

  if (hasCat) {
    const pill = document.createElement('span');
    pill.className = 'active-filter-pill';
    pill.innerHTML = `<span class="afp-label">Category: <strong>${_state.categoryFilter}</strong></span>`
      + `<button class="afp-remove" title="Clear category filter">×</button>`;
    pill.querySelector('.afp-remove').addEventListener('click', () => applyCategoryFilter(null));
    filterBar.appendChild(pill);
  }

  if (hasTag && hasCat) {
    const clear = document.createElement('button');
    clear.className = 'afp-clear-all';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => {
      _state.tagFilter = null;
      _state.categoryFilter = null;
      document.querySelectorAll('.tag-item, .cat-item').forEach((el) => el.classList.remove('active'));
      renderActiveFilters();
      loadEntries();
      clearDetail();
    });
    filterBar.appendChild(clear);
  }
}

// ── Entry detail ───────────────────────────────────────────────────────────

const detailTagsSuggestions = document.getElementById('detail-tags-suggestions');
let _detailSuggestTimer = null;

// Render editable tag chips in the detail panel.
// Tags are shown as removable pills; an input at the end lets the user add more.
function renderDetailTags(tags) {
  detailTagsChips.innerHTML = '';
  const currentNames = tags.map((t) => t.name || t);

  currentNames.forEach((name) => {
    const chip = document.createElement('span');
    chip.className = 'detail-tag-chip';
    chip.innerHTML = `<span class="dtc-name">#${name}</span><button class="dtc-remove" title="Remove tag" aria-label="Remove ${name}">×</button>`;
    chip.querySelector('.dtc-name').addEventListener('click', () => applyTagFilter(name));
    chip.querySelector('.dtc-remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = currentNames.filter((n) => n !== name);
      await _saveTags(updated);
    });
    detailTagsChips.appendChild(chip);
  });

  detailTagsInput.value = '';
}

function _renderDetailSuggestions(suggested) {
  detailTagsSuggestions.innerHTML = '';
  const current = new Set(
    Array.from(detailTagsChips.querySelectorAll('.dtc-name'))
      .map((el) => el.textContent.replace(/^#/, ''))
  );
  const fresh = suggested.filter((t) => !current.has(t));
  if (!fresh.length) return;

  const label = document.createElement('span');
  label.className = 'detail-suggestions-label';
  label.textContent = 'Suggestions:';
  detailTagsSuggestions.appendChild(label);

  fresh.forEach((tag) => {
    const pill = document.createElement('button');
    pill.className = 'detail-tag-suggestion';
    pill.type = 'button';
    pill.textContent = `#${tag}`;
    pill.addEventListener('click', async () => {
      const existing = Array.from(detailTagsChips.querySelectorAll('.dtc-name'))
        .map((el) => el.textContent.replace(/^#/, ''));
      await _saveTags([...new Set([...existing, tag])]);
      pill.remove();
      if (detailTagsSuggestions.querySelectorAll('.detail-tag-suggestion').length === 0) {
        detailTagsSuggestions.innerHTML = '';
      }
    });
    detailTagsSuggestions.appendChild(pill);
  });
}

async function _fetchDetailSuggestions(entryContent) {
  if (!entryContent || entryContent.length < 20) return;
  try {
    const result = await window.neurologue.suggestTags(entryContent);
    if (result.ok && result.suggestions.length > 0) {
      _renderDetailSuggestions(result.suggestions);
    }
  } catch {
    // best-effort
  }
}

async function _saveTags(tagNames) {
  if (!_state.selectedId) return;
  const result = await window.neurologue.setTags(_state.selectedId, tagNames);
  if (result.ok) {
    renderDetailTags(result.entry.tags || []);
    // Refresh the card in the timeline so the chip row stays in sync
    const card = document.querySelector(`.entry-card[data-id="${_state.selectedId}"]`);
    if (card) {
      const updated = result.entry;
      // Re-render the chips row on the card
      const oldChips = card.querySelector('.entry-chips');
      const cat = updated.user_category || updated.category;
      const hasTags = updated.tags && updated.tags.length > 0;
      if (hasTags || cat) {
        const chipRow = document.createElement('div');
        chipRow.className = 'entry-chips';
        if (hasTags) {
          updated.tags.slice(0, 6).forEach((t) => {
            const pill = document.createElement('span');
            pill.className = 'tag-pill';
            pill.textContent = `#${t.name || t}`;
            chipRow.appendChild(pill);
          });
        }
        if (cat) {
          const badge = document.createElement('span');
          badge.className = 'category-badge category-badge--card';
          badge.setAttribute('data-cat', cat);
          badge.textContent = cat;
          chipRow.appendChild(badge);
        }
        if (oldChips) { card.replaceChild(chipRow, oldChips); } else { card.appendChild(chipRow); }
      } else if (oldChips) {
        oldChips.remove();
      }
    }
    await loadTags(); // refresh sidebar tag list
  }
}

// Commit whatever is in the tag input field as a new tag
async function _commitTagInput() {
  const raw = detailTagsInput.value.trim();
  if (!raw) return;
  const newNames = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!newNames.length) return;
  const existing = Array.from(detailTagsChips.querySelectorAll('.dtc-name'))
    .map((el) => el.textContent.replace(/^#/, ''));
  const merged = [...new Set([...existing, ...newNames])];
  await _saveTags(merged);
}

detailTagsInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    await _commitTagInput();
  }
});
detailTagsInput.addEventListener('blur', () => _commitTagInput());

// ── Similar entries (semantic neighbours) ─────────────────────────────────

const similarSection   = document.getElementById('similar-entries-section');
const similarToggle    = document.getElementById('similar-entries-toggle');
const similarList      = document.getElementById('similar-entries-list');
const similarNoEmbed   = document.getElementById('similar-entries-no-embedding');
let _similarTimer      = null;

function resetSimilarEntries() {
  similarToggle.setAttribute('aria-expanded', 'false');
  similarList.hidden = true;
  similarList.innerHTML = '';
  similarNoEmbed.hidden = true;
  similarSection.style.display = 'none';
}

async function _loadSimilarEntries(entryId) {
  try {
    const result = await window.neurologue.similarEntries(entryId);
    if (!result.ok) {
      if (result.reason === 'no_embedding') {
        similarSection.style.display = 'block';
        similarNoEmbed.hidden = false;
      }
      // any other failure: leave section hidden
      return;
    }
    if (result.results.length === 0) {
      // leave section hidden — nothing to show
      return;
    }
    similarSection.style.display = 'block';
    similarList.innerHTML = '';
    result.results.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'similar-entry-card';
      // Convert distance to a 0–100% similarity score (LanceDB uses L2 distance)
      const sim = entry._distance !== undefined
        ? Math.max(0, Math.round((1 - Math.min(entry._distance, 1)) * 100))
        : null;
      card.innerHTML =
        `<div class="sec-meta">` +
        `<span class="sec-date">${formatDate(entry.created_at)}</span>` +
        (sim !== null ? `<span class="sec-sim">${sim}% similar</span>` : '') +
        `</div>` +
        `<div class="sec-preview">${escHtml(entry.content)}</div>`;
      card.addEventListener('click', () => selectEntry(entry.id));
      similarList.appendChild(card);
    });
  } catch (err) {
    showToast(`Similar entries failed: ${err && err.message ? err.message : err}`, 'error');
  }
}

similarToggle.addEventListener('click', () => {
  const expanded = similarToggle.getAttribute('aria-expanded') === 'true';
  similarToggle.setAttribute('aria-expanded', String(!expanded));
  similarList.hidden = expanded;
});

// Re-embed a single entry on demand (shown when no embedding exists yet)
document.getElementById('btn-reindex-entry').addEventListener('click', async () => {
  const id = _state.selectedId;
  if (!id) return;
  similarNoEmbed.hidden = true;
  await window.neurologue.reindexEntry(id);
});

// ── Select entry (show in detail panel) ────────────────────────────────────
async function selectEntry(id) {
  _state.selectedId = id;

  // Reset any sub-mode
  exitEditMode();
  exitHistoryMode();

  // Update card selection highlight
  document.querySelectorAll('.entry-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  try {
    const entry = await window.neurologue.getEntry(id);
    if (!entry) return;

    // Fix: pass raw date strings to formatDate, not already-formatted strings
    detailDate.textContent = entry.edited_at
      ? `${formatDate(entry.created_at)} \u00b7 edited ${formatDate(entry.edited_at)}`
      : formatDate(entry.created_at);
    detailSource.textContent = `Source: ${entry.source || 'manual'}  \u00b7  Type: ${entry.type || 'note'}`;
    detailText.textContent = entry.content;
    // Category: user_category overrides the LLM-assigned category
    const displayCat = entry.user_category || entry.category || null;
    detailCategoryBadge.textContent = displayCat || '';
    detailCategoryBadge.setAttribute('data-cat', displayCat || '');
    detailCategorySelect.value = entry.user_category || '';
    renderDetailTags(entry.tags || []);

    // Clear stale suggestions then fetch fresh ones (debounced to avoid hammering on quick selection)
    detailTagsSuggestions.innerHTML = '';
    clearTimeout(_detailSuggestTimer);
    _detailSuggestTimer = setTimeout(() => _fetchDetailSuggestions(entry.content), 600);

    // Reset similar entries — collapse and clear, then load lazily
    resetSimilarEntries();
    clearTimeout(_similarTimer);
    _similarTimer = setTimeout(() => _loadSimilarEntries(id), 800);

    detailPlaceholder.style.display = 'none';
    detailContent.style.display = 'flex';
  } catch (err) {
    console.error('[library] selectEntry failed:', err);
  }
}

function clearDetail() {
  _state.selectedId = null;
  exitEditMode();
  exitHistoryMode();
  clearTimeout(_similarTimer);
  resetSimilarEntries();
  detailPlaceholder.style.display = 'flex';
  detailContent.style.display = 'none';
}

// ── Search mode toggle ─────────────────────────────────────────────────────

function setMode(mode) {
  _state.mode = mode;
  btnText.classList.toggle('active', mode === 'text');
  btnSemantic.classList.toggle('active', mode === 'semantic');
  if (_state.query.trim()) loadEntries();
}

// ── Event wiring ───────────────────────────────────────────────────────────

const debouncedSearch = debounce(() => {
  _state.query = searchInput.value;
  loadEntries();
}, 300);

searchInput.addEventListener('input', debouncedSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchInput.value = ''; debouncedSearch(); }
});

btnText.addEventListener('click', () => setMode('text'));
btnSemantic.addEventListener('click', () => setMode('semantic'));
tagAll.addEventListener('click', () => applyTagFilter(null));
loadMoreBtn.addEventListener('click', () => loadEntries(true));

// Infinite scroll: trigger when within 200px of the bottom of the list
timelineList.addEventListener('scroll', () => {
  if (!_state.hasMore || _loadingMore) return;
  const { scrollTop, scrollHeight, clientHeight } = timelineList;
  if (scrollHeight - scrollTop - clientHeight < 200) {
    _loadingMore = true;
    loadEntries(true).finally(() => { _loadingMore = false; });
  }
});

// Group-by buttons
function setGroupBy(groupBy) {
  _state.groupBy = groupBy;
  [grpNoneBtn, grpDayBtn, grpWeekBtn, grpMonthBtn].forEach((btn) => btn.classList.remove('active'));
  const active = groupBy === 'day' ? grpDayBtn
    : groupBy === 'week' ? grpWeekBtn
    : groupBy === 'month' ? grpMonthBtn
    : grpNoneBtn;
  active.classList.add('active');
  loadEntries();
}
grpNoneBtn.addEventListener('click',  () => setGroupBy(null));
grpDayBtn.addEventListener('click',   () => setGroupBy('day'));
grpWeekBtn.addEventListener('click',  () => setGroupBy('week'));
grpMonthBtn.addEventListener('click', () => setGroupBy('month'));

// Heatmap toggle
heatmapToggle.addEventListener('click', async () => {
  const visible = !heatmapPanel.classList.contains('hidden');
  if (visible) {
    heatmapPanel.classList.add('hidden');
    heatmapToggle.classList.remove('active');
  } else {
    heatmapPanel.classList.remove('hidden');
    heatmapToggle.classList.add('active');
    await renderHeatmap();
  }
});

// ── Category override ──────────────────────────────────────────────────────

detailCategorySelect.addEventListener('change', async () => {
  if (!_state.selectedId) return;
  const selected = detailCategorySelect.value || null; // '' → clear (revert to auto)
  try {
    const result = await window.neurologue.setCategory(_state.selectedId, selected);
    if (result.ok) {
      const displayCat = result.entry.user_category || result.entry.category || null;
      detailCategoryBadge.textContent = displayCat || '';
      detailCategoryBadge.setAttribute('data-cat', displayCat || '');
    }
  } catch (err) {
    console.error('[library] setCategory failed:', err);
  }
});

// ── Markdown utilities (used by edit panel) ────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineHtml(text) {
  return escHtml(text)
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

function parseMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code.push(escHtml(lines[i])); i++; }
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      i++; continue;
    }
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) { out.push(`<h${hm[1].length}>${inlineHtml(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const bq = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { bq.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inlineHtml(bq.join(' '))}</blockquote>`); continue;
    }
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) { items.push(`<li>${inlineHtml(lines[i].replace(/^[-*+]\s/, ''))}</li>`); i++; }
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(`<li>${inlineHtml(lines[i].replace(/^\d+\.\s/, ''))}</li>`); i++; }
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(`<p>${inlineHtml(line)}</p>`);
    i++;
  }
  return out.join('');
}

// ── Edit mode ──────────────────────────────────────────────────────────────

let _editPreviewMode = false;
const etbPreviewBtn = document.getElementById('etb-preview');

function wrapEditSelection(before, after, placeholder) {
  if (_editPreviewMode) return;
  const start = editTextarea.selectionStart;
  const end   = editTextarea.selectionEnd;
  const sel   = editTextarea.value.slice(start, end) || placeholder;
  editTextarea.setRangeText(before + sel + after, start, end, 'select');
  editTextarea.focus();
}

function prependEditLines(prefix) {
  if (_editPreviewMode) return;
  const text  = editTextarea.value;
  const start = editTextarea.selectionStart;
  const end   = editTextarea.selectionEnd;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd   = text.indexOf('\n', end);
  const block = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const prefixed = block.split('\n').map(l => prefix + l).join('\n');
  editTextarea.setRangeText(prefixed, lineStart, lineEnd === -1 ? text.length : lineEnd, 'select');
  editTextarea.focus();
}

function setEditPreviewMode(on) {
  _editPreviewMode = on;
  etbPreviewBtn.classList.toggle('active', on);
  if (on) {
    editPreview.innerHTML = parseMarkdown(editTextarea.value);
    editTextarea.style.display = 'none';
    editPreview.style.display = 'block';
  } else {
    editTextarea.style.display = '';
    editPreview.style.display = 'none';
    if (document.activeElement !== editTextarea) editTextarea.focus();
  }
}

document.getElementById('etb-bold')  .addEventListener('click', () => wrapEditSelection('**', '**', 'bold text'));
document.getElementById('etb-italic').addEventListener('click', () => wrapEditSelection('*',  '*',  'italic text'));
document.getElementById('etb-code')  .addEventListener('click', () => wrapEditSelection('`',  '`',  'code'));
document.getElementById('etb-ul')    .addEventListener('click', () => prependEditLines('- '));
document.getElementById('etb-quote') .addEventListener('click', () => prependEditLines('> '));
document.getElementById('etb-link')  .addEventListener('click', () => wrapEditSelection('[', '](https://)', 'link text'));
etbPreviewBtn.addEventListener('click', () => setEditPreviewMode(!_editPreviewMode));

function enterEditMode() {
  exitHistoryMode();
  editTextarea.value = detailText.textContent;
  setEditPreviewMode(false);
  detailRead.style.display = 'none';
  detailEdit.style.display = 'flex';
  btnEdit.classList.add('active');
  btnEdit.textContent = 'Editing…';
  editTextarea.focus();
  editTextarea.setSelectionRange(editTextarea.value.length, editTextarea.value.length);
}

function exitEditMode() {
  detailRead.style.display = 'block';
  detailEdit.style.display = 'none';
  setEditPreviewMode(false);
  btnEdit.classList.remove('active');
  btnEdit.textContent = 'Edit';
}

btnEdit.addEventListener('click', () => {
  if (detailEdit.style.display !== 'none') {
    exitEditMode();
  } else {
    enterEditMode();
  }
});

btnEditCancel.addEventListener('click', exitEditMode);

btnEditSave.addEventListener('click', async () => {
  const newContent = editTextarea.value.trim();
  if (!newContent || !_state.selectedId) return;

  btnEditSave.disabled = true;
  btnEditSave.textContent = 'Saving…';

  try {
    const result = await window.neurologue.updateEntry(_state.selectedId, newContent);
    if (result.ok) {
      exitEditMode();
      await selectEntry(_state.selectedId);
      document.querySelectorAll('.entry-card').forEach((c) => {
        if (c.dataset.id === _state.selectedId) {
          const preview = c.querySelector('.entry-preview');
          if (preview) preview.textContent = newContent;
        }
      });
    } else {
      console.error('[library] updateEntry failed:', result.error);
    }
  } catch (err) {
    console.error('[library] updateEntry error:', err);
  } finally {
    btnEditSave.disabled = false;
    btnEditSave.textContent = 'Save';
  }
});

editTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btnEditSave.click(); }
  if (e.key === 'Escape') { e.preventDefault(); exitEditMode(); }
  if ((e.key === 'b') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapEditSelection('**', '**', 'bold text'); }
  if ((e.key === 'i') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapEditSelection('*', '*', 'italic text'); }
});

// ── Revision history ───────────────────────────────────────────────────────

function exitHistoryMode() {
  detailHistory.style.display = 'none';
  detailRead.style.display    = 'block';
  detailFooterRead.style.display    = 'flex';
  detailFooterHistory.style.display = 'none';
  btnHistory.classList.remove('active');
}

btnHistory.addEventListener('click', async () => {
  if (detailHistory.style.display !== 'none') { exitHistoryMode(); return; }
  if (!_state.selectedId) return;

  exitEditMode();

  try {
    const [entry, revisions] = await Promise.all([
      window.neurologue.getEntry(_state.selectedId),
      window.neurologue.getRevisions(_state.selectedId),
    ]);

    historyList.innerHTML = '';

    const versions = [
      { label: 'Current version', date: entry.edited_at || entry.created_at, content: entry.content },
      ...revisions.map((r, idx) => ({
        label: `Version ${revisions.length - idx}`,
        date: r.created_at,
        content: r.content,
      })),
    ];

    if (versions.length === 1 && !entry.edited_at) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:12px;font-size:12px;color:var(--text-dim)';
      msg.textContent = 'This entry has not been edited yet.';
      historyList.appendChild(msg);
    } else {
      versions.forEach((v) => {
        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML =
          `<div class="history-card-header">` +
          `<span class="history-card-date">${v.label} · ${formatDate(v.date)}</span>` +
          `<button class="history-card-copy">Copy</button>` +
          `</div>` +
          `<div class="history-card-body"></div>`;
        card.querySelector('.history-card-body').textContent = v.content;
        card.querySelector('.history-card-copy').addEventListener('click', () => {
          navigator.clipboard.writeText(v.content).catch(() => {});
        });
        historyList.appendChild(card);
      });
    }

    detailRead.style.display    = 'none';
    detailHistory.style.display = 'flex';
    detailFooterRead.style.display    = 'none';
    detailFooterHistory.style.display = 'flex';
    btnHistory.classList.add('active');
  } catch (err) {
    console.error('[library] getRevisions failed:', err);
  }
});

document.getElementById('btn-history-back').addEventListener('click', exitHistoryMode);

document.getElementById('btn-history-export').addEventListener('click', async () => {
  if (!_state.selectedId) return;
  try {
    const [entry, revisions] = await Promise.all([
      window.neurologue.getEntry(_state.selectedId),
      window.neurologue.getRevisions(_state.selectedId),
    ]);
    const lines = [
      `=== Current version (${formatDate(entry.edited_at || entry.created_at)}) ===`,
      entry.content,
      ...revisions.map((r, idx) =>
        `\n=== Version ${revisions.length - idx} (${formatDate(r.created_at)}) ===\n${r.content}`
      ),
    ];
    await navigator.clipboard.writeText(lines.join('\n'));
  } catch (err) {
    console.error('[library] copy history failed:', err);
  }
});

// ── Export modal ────────────────────────────────────────────────────────────

// Delete entry
document.getElementById('btn-delete-entry').addEventListener('click', async () => {
  if (!_state.selectedId) return;
  const confirmed = confirm('Delete this note permanently? This cannot be undone.');
  if (!confirmed) return;
  const id = _state.selectedId;
  const result = await window.neurologue.deleteEntry(id);
  if (!result.ok) { alert(`Delete failed: ${result.error}`); return; }
  _state.selectedId = null;
  await loadEntries();
  await loadTags();
  await loadCategories();
  // Clear detail panel
  document.getElementById('detail-placeholder').removeAttribute('hidden');
  document.getElementById('detail-content').setAttribute('hidden', '');
});

let _exportToastTimer = null;

function showToast(message, type = 'success') {
  exportToast.textContent = message;
  exportToast.className = type;
  exportToast.style.display = 'block';
  clearTimeout(_exportToastTimer);
  _exportToastTimer = setTimeout(() => { exportToast.style.display = 'none'; }, 5000);
}

const exportModal      = document.getElementById('export-modal');
const exportModalClose = document.getElementById('export-modal-close');
const exportCancelBtn  = document.getElementById('btn-export-cancel');
const exportConfirmBtn = document.getElementById('btn-export-confirm');
const exportFmtChecks  = () => [...document.querySelectorAll('.export-fmt-check')];

function openExportModal() { exportModal.classList.remove('hidden'); }
function closeExportModal() { exportModal.classList.add('hidden'); }

exportBtn.addEventListener('click', openExportModal);
exportModalClose.addEventListener('click', closeExportModal);
exportCancelBtn.addEventListener('click', closeExportModal);

exportModal.addEventListener('click', (e) => {
  if (e.target === exportModal) closeExportModal();
});

exportConfirmBtn.addEventListener('click', async () => {
  const formats = exportFmtChecks()
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);

  if (formats.length === 0) {
    showToast('Select at least one format.', 'error');
    return;
  }

  closeExportModal();
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting…';
  try {
    const result = await window.neurologue.exportAll({ formats });
    if (result.canceled) {
      showToast('Export cancelled.', 'success');
    } else {
      showToast(
        `Exported ${result.entryCount} entries, ${result.themeCount} themes → ${result.destDir}`,
        'success'
      );
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export…';
  }
});

helpBtn.addEventListener('click', () => {
  window.neurologue.openHelp();
});

newNoteBtn.addEventListener('click', () => {
  window.neurologue.openCapture();
});

// ── Status bar ──────────────────────────────────────────────────────────────

const TASK_LABELS = {
  embedding:          'Embedding',
  classification:     'Classifying',
  clustering:         'Clustering',
  'contradiction-scan': 'Contradiction scan',
  signals:            'Entry signals',
};

function updateStatus({ worker, ollama } = {}) {
  if (ollama) {
    const dot = ollama.running ? 'active' : '';
    const loaded = ollama.loadedModels || [];
    const loadedStr = loaded.length > 0 ? ` · ${loaded.length} active` : '';
    const label = ollama.running
      ? `Ollama — ${ollama.availableModels.join(', ') || 'no models'}${loadedStr}`
      : 'Ollama not running';
    statusOllama.innerHTML = `<span class="status-dot ${dot}"></span>${label}`;
  }
  if (worker) {
    const processing = worker.queueLength > 0;
    const classifying = !processing && worker.classifyQueueLength > 0;
    const dot = (processing || classifying) ? 'processing' : (worker.running ? 'active' : '');
    let label;
    if (!worker.running) {
      label = 'Worker stopped';
    } else if (processing) {
      label = `Processing (${worker.queueLength} queued)`;
    } else if (classifying) {
      label = `Classifying (${worker.classifyQueueLength} queued)`;
    } else if (worker.lastProcessed) {
      const d = new Date(worker.lastProcessed);
      const ts = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      label = `Worker idle — last: ${ts}`;
    } else {
      label = 'Worker idle';
    }
    statusWorker.innerHTML = `<span class="status-dot ${dot}"></span>${label}`;

    // Current task in-progress indicator
    if (worker.currentTask) {
      const taskLabel = TASK_LABELS[worker.currentTask.task] || worker.currentTask.task;
      statusTask.innerHTML = `<span class="status-task-spinner"></span>${taskLabel}…`;
      statusTask.classList.remove('hidden');
    } else {
      statusTask.classList.add('hidden');
    }

    // Error badge
    if (worker.lastError) {
      statusErrorBadge.classList.remove('hidden');
    } else {
      statusErrorBadge.classList.add('hidden');
    }
  }
}

// Live task started/completed → update status task indicator
window.neurologue.onWorkerTaskStarted(({ task }) => {
  const label = TASK_LABELS[task] || task;
  statusTask.innerHTML = `<span class="status-task-spinner"></span>${label}…`;
  statusTask.classList.remove('hidden');
});

window.neurologue.onWorkerTaskCompleted(({ task, status, message }) => {
  statusTask.classList.add('hidden');
  if (status === 'error') {
    statusErrorBadge.classList.remove('hidden');
    statusErrorBadge.title = `${TASK_LABELS[task] || task} failed: ${message}`;
  }
});

// Clicking the error badge opens Settings → Worker tab
statusErrorBadge.addEventListener('click', () => {
  settingsModal.classList.remove('hidden');
  window.neurologue.pauseHotkey();
  activateSettingsTab('worker');
  renderWorkerLog();
});

window.neurologue.onWorkerStatus(updateStatus);

// Surface unexpected main-process IPC errors as toasts so they are visible
window.neurologue.onIpcError(({ channel, message }) => {
  showToast(`Error (${channel}): ${message}`, 'error');
});

// ── Theme ───────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'dark');
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === (theme || 'dark'));
  });
}

document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeValue));
});

window.neurologue.onEntriesUpdated(async () => {
  await loadEntries();
  await loadTags();
  await loadCategories();
  // Refresh the detail panel if a selected entry may now have a category assigned
  if (_state.selectedId) {
    const entry = await window.neurologue.getEntry(_state.selectedId);
    if (entry && !entry.user_category) {
      const cat = entry.category || null;
      detailCategoryBadge.textContent = cat || '';
      detailCategoryBadge.setAttribute('data-cat', cat || '');
    }
  }
});
window.neurologue.onThemesUpdated(() => loadThemesView());
window.neurologue.onThemesUpdated(() => {
  if (document.getElementById('view-priorities').classList.contains('active-view')) loadPrioritiesView();
});
window.neurologue.onContradictionsUpdated(() => loadContradictionsView());

// ── Setup + settings modals ────────────────────────────────────────

const setupModal    = document.getElementById('setup-modal');
const settingsModal = document.getElementById('settings-modal');
const btnSettings   = document.getElementById('btn-settings');

function showSetupStep(stepId) {
  document.querySelectorAll('.setup-step').forEach((el) => el.classList.add('hidden'));
  document.getElementById(stepId).classList.remove('hidden');
}

function showSetupModal(step, data = {}) {
  if (step === 'install') showSetupStep('step-install');
  if (step === 'start')   showSetupStep('step-start');
  if (step === 'models') {
    showSetupStep('step-models');
    renderModelPullList(data.missing || []);
  }
  setupModal.classList.remove('hidden');
}

function hideSetupModal() { setupModal.classList.add('hidden'); }

// Build the per-model rows in the pull step
function renderModelPullList(missing) {
  const list = document.getElementById('model-pull-list');
  list.innerHTML = '';
  missing.forEach((name) => {
    const safeId = name.replace(/[^a-z0-9]/gi, '-');
    const row = document.createElement('div');
    row.className = 'model-row';
    row.innerHTML =
      `<div class="model-row-header">` +
      `<span class="model-name">${name}</span>` +
      `<span class="model-status" id="mstatus-${safeId}">Not pulled</span>` +
      `</div>` +
      `<div class="progress-bar-outer hidden" id="mbar-outer-${safeId}">` +
      `<div class="progress-bar-inner" id="mbar-${safeId}"></div>` +
      `</div>`;
    list.appendChild(row);
  });
}

// Stream progress from ollama:pull-progress IPC events
window.neurologue.onPullProgress((progress) => {
  const safeId    = (progress.name || '').replace(/[^a-z0-9]/gi, '-');
  const statusEl  = document.getElementById(`mstatus-${safeId}`);
  const barOuter  = document.getElementById(`mbar-outer-${safeId}`);
  const barInner  = document.getElementById(`mbar-${safeId}`);
  if (!statusEl) return;

  if (progress.total && progress.completed !== undefined) {
    barOuter && barOuter.classList.remove('hidden');
    const pct = Math.round((progress.completed / progress.total) * 100);
    if (barInner) barInner.style.width = pct + '%';
    statusEl.textContent = `Downloading… ${pct}%`;
  } else if (progress.status === 'success') {
    barOuter && barOuter.classList.add('hidden');
    statusEl.textContent = '✓ Ready';
  } else {
    statusEl.textContent = progress.status || 'Working…';
  }
});

async function pullAllMissing() {
  const pullAllBtn = document.getElementById('btn-pull-all');
  const missing = Array.from(
    document.querySelectorAll('#model-pull-list .model-name')
  ).map((el) => el.textContent);

  pullAllBtn.disabled    = true;
  pullAllBtn.textContent = 'Pulling…';

  for (const name of missing) {
    const result = await window.neurologue.pullModel(name);
    if (!result.ok) {
      const safeId = name.replace(/[^a-z0-9]/gi, '-');
      const statusEl = document.getElementById(`mstatus-${safeId}`);
      if (statusEl) statusEl.textContent = `Error: ${result.error}`;
    }
  }

  pullAllBtn.disabled    = false;
  pullAllBtn.textContent = 'Pull all missing models';

  const newStatus = await window.neurologue.getStatus();
  updateStatus(newStatus);
  hideSetupModal();
}

document.getElementById('setup-close').addEventListener('click', hideSetupModal);

document.getElementById('btn-ollama-download').addEventListener('click', () => {
  window.neurologue.openOllamaDownload();
});

document.getElementById('btn-recheck-install').addEventListener('click', async () => {
  const result = await window.neurologue.checkOllamaInstalled();
  if (result.installed) {
    const status = await window.neurologue.getStatus();
    updateStatus(status);
    if (!status.ollama.running) {
      showSetupModal('start');
    } else {
      await runModelCheck(status);
    }
  }
});

document.getElementById('btn-recheck-running').addEventListener('click', async () => {
  const status = await window.neurologue.getStatus();
  updateStatus(status);
  if (status.ollama.running) {
    await runModelCheck(status);
  }
});

document.getElementById('btn-pull-all').addEventListener('click', pullAllMissing);

// ── Settings modal ─────────────────────────────────────────────────

// Tab switching
function activateSettingsTab(name) {
  document.querySelectorAll('.settings-tab').forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.settings-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== `settings-tab-${name}`);
  });
}

document.querySelectorAll('.settings-tab').forEach((tab) => {
  tab.addEventListener('click', () => activateSettingsTab(tab.dataset.tab));
});

// ── Hotkey recorder ─────────────────────────────────────────────────────────
let _recordingHotkey = false;
let _pendingHotkey   = null;

const hotkeyDisplay  = document.getElementById('hotkey-display');
const btnRecord      = document.getElementById('btn-record-hotkey');
const hotkeyConflict = document.getElementById('hotkey-conflict');

/** Convert a keyboard event to an Electron accelerator string, or null if invalid. */
function keyEventToAccelerator(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'Command'].includes(e.key)) return null;
  if (e.key === 'Escape') return null; // Escape cancels recording

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey)  parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null; // require at least one modifier

  const KEY_MAP = {
    ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'ArrowLeft': 'Left', 'ArrowRight': 'Right',
    'Enter': 'Return',
  };
  const mapped = KEY_MAP[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(mapped);
  return parts.join('+');
}

/** Format an Electron accelerator for display (e.g. 'CommandOrControl+Shift+Space' → 'Ctrl+Shift+Space'). */
function formatAccelerator(acc) {
  return acc.replace('CommandOrControl', 'Ctrl');
}

function onHotkeyKeydown(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { stopHotkeyRecording(true); return; }
  const acc = keyEventToAccelerator(e);
  if (!acc) return;
  _pendingHotkey = acc;
  hotkeyDisplay.textContent = formatAccelerator(acc);
  stopHotkeyRecording(false);
}

function startHotkeyRecording() {
  _recordingHotkey = true;
  hotkeyDisplay.textContent = 'Press keys…';
  hotkeyDisplay.classList.add('recording');
  btnRecord.textContent = 'Cancel';
  btnRecord.classList.add('recording');
  hotkeyConflict.classList.add('hidden');
  document.addEventListener('keydown', onHotkeyKeydown, { capture: true });
}

function stopHotkeyRecording(restore) {
  _recordingHotkey = false;
  document.removeEventListener('keydown', onHotkeyKeydown, { capture: true });
  hotkeyDisplay.classList.remove('recording');
  btnRecord.textContent = 'Change';
  btnRecord.classList.remove('recording');
  if (restore) {
    // Revert display to the last saved or pending hotkey
    const current = _pendingHotkey || hotkeyDisplay.dataset.saved || '';
    hotkeyDisplay.textContent = current ? formatAccelerator(current) : '';
  }
}

btnRecord.addEventListener('click', () => {
  if (_recordingHotkey) stopHotkeyRecording(true);
  else startHotkeyRecording();
});
// ────────────────────────────────────────────────────────────────────────────

btnSettings.addEventListener('click', async () => {
  _pendingHotkey = null;
  hotkeyConflict.classList.add('hidden');
  const [settings, status] = await Promise.all([
    window.neurologue.getSettings(),
    window.neurologue.getStatus(),
  ]);
  const available = status.ollama.availableModels;

  function buildOptions(selectId, models, current) {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    // Always include the currently configured model even if Ollama is offline
    const allModels = [...new Set([current, ...models])].filter(Boolean);
    allModels.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      opt.selected = (m === current);
      select.appendChild(opt);
    });
  }

  buildOptions('select-embed-model', available, settings.embeddingModel);
  buildOptions('select-llm-model',   available, settings.llmModel);

  // Tag suggestion format
  const tagFmtSelect = document.getElementById('select-tag-format');
  if (tagFmtSelect) tagFmtSelect.value = settings.tagSuggestionFormat || 'hyphenated';

  // Duplicate detection threshold
  const simSelect = document.getElementById('select-similarity-threshold');
  if (simSelect) simSelect.value = String(settings.tagSimilarityThreshold ?? 0.88);

  // Populate hotkey display
  const currentHotkey = settings.captureHotkey || 'CommandOrControl+Shift+Space';
  hotkeyDisplay.dataset.saved = currentHotkey;
  hotkeyDisplay.textContent   = formatAccelerator(currentHotkey);

  // Populate appearance toggle
  applyTheme(settings.theme || 'dark');

  // Populate worker interval inputs
  const wi = settings.workerIntervals || {};
  const inputEmbed  = document.getElementById('input-interval-embedding');
  const inputClust  = document.getElementById('input-interval-clustering');
  const inputContra = document.getElementById('input-interval-contradiction');
  if (inputEmbed)  inputEmbed.value  = wi.embedding     ?? 60;
  if (inputClust)  inputClust.value  = wi.clustering    ?? 300;
  if (inputContra) inputContra.value = wi.contradiction ?? 900;

  activateSettingsTab('models');
  settingsModal.classList.remove('hidden');
  window.neurologue.pauseHotkey();
});

document.getElementById('settings-close').addEventListener('click', () => {
  if (_recordingHotkey) stopHotkeyRecording(true);
  settingsModal.classList.add('hidden');
  window.neurologue.resumeHotkey();
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const embedModel = document.getElementById('select-embed-model').value;
  const llmModel   = document.getElementById('select-llm-model').value;
  const tagFmt     = (document.getElementById('select-tag-format') || {}).value || 'hyphenated';
  const tagSimRaw  = (document.getElementById('select-similarity-threshold') || {}).value;
  const tagSimilarityThreshold = tagSimRaw ? parseFloat(tagSimRaw) : 0.88;

  // Apply hotkey change first if the user recorded a new one
  if (_pendingHotkey) {
    const result = await window.neurologue.setHotkey(_pendingHotkey);
    if (!result.ok) {
      hotkeyConflict.classList.remove('hidden');
      return; // Don't close — let user pick a different shortcut
    }
    hotkeyConflict.classList.add('hidden');
    hotkeyDisplay.dataset.saved = _pendingHotkey;
    _pendingHotkey = null;
  }

  const selectedTheme = document.querySelector('.theme-toggle-btn.active')?.dataset.themeValue || 'dark';
  applyTheme(selectedTheme);

  await window.neurologue.saveSettings({
    embeddingModel: embedModel,
    llmModel,
    tagSuggestionFormat: tagFmt,
    tagSimilarityThreshold,
    theme: selectedTheme,
    workerIntervals: {
      embedding:     parseInt(document.getElementById('input-interval-embedding').value, 10)    || 60,
      clustering:    parseInt(document.getElementById('input-interval-clustering').value, 10)   || 300,
      contradiction: parseInt(document.getElementById('input-interval-contradiction').value, 10) || 900,
    },
  });
  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
});

// Reindex all entries — clear all embeddings and re-queue everything
document.getElementById('btn-reindex-all').addEventListener('click', async () => {
  const confirmed = confirm(
    'This will clear all stored embeddings and re-process every entry from scratch.\n\n' +
    'Ollama must be running, and processing will happen in the background. Continue?'
  );
  if (!confirmed) return;
  const { queued } = await window.neurologue.reindexAll();
  const settingsModal = document.getElementById('settings-modal');
  settingsModal.classList.add('hidden');
  window.neurologue.resumeHotkey();
  console.info(`[library] Reindex started — ${queued} entries queued`);
});

// ── Worker log ───────────────────────────────────────────────────────────────

function _formatWLTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function renderWorkerLog() {
  const panel = document.getElementById('worker-log-panel');
  if (!panel) return;
  const entries = await window.neurologue.getWorkerLog();
  panel.innerHTML = '';
  if (!entries || entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'worker-log-empty';
    empty.textContent = 'No tasks recorded yet.';
    panel.appendChild(empty);
    return;
  }
  // Newest first
  [...entries].reverse().forEach((e) => {
    const row = document.createElement('div');
    row.className = 'worker-log-row';

    const dot = document.createElement('span');
    dot.className = `wlr-status ${e.status || 'running'}`;
    row.appendChild(dot);

    const task = document.createElement('span');
    task.className = 'wlr-task';
    task.textContent = TASK_LABELS[e.task] || e.task;
    row.appendChild(task);

    const msg = document.createElement('span');
    msg.className = 'wlr-msg';
    msg.textContent = e.message || '';
    row.appendChild(msg);

    const dur = document.createElement('span');
    dur.className = 'wlr-dur';
    dur.textContent = e.durationMs != null ? `${e.durationMs}ms` : '…';
    row.appendChild(dur);

    const time = document.createElement('span');
    time.className = 'wlr-time';
    time.textContent = _formatWLTime(e.startedAt);
    row.appendChild(time);

    panel.appendChild(row);
  });
}

document.getElementById('btn-refresh-worker-log').addEventListener('click', renderWorkerLog);

// Load the worker log whenever the Worker settings tab is activated
document.querySelectorAll('.settings-tab').forEach((tab) => {
  if (tab.dataset.tab === 'worker') {
    tab.addEventListener('click', renderWorkerLog);
  }
});

// ── Scheduled Export settings ────────────────────────────────────────────────

let _schedConfig = {};

function _fmtSchedDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function loadSchedSettings() {
  const status = await window.neurologue.schedulerStatus();
  _schedConfig = { ...status };

  document.getElementById('sched-enabled').checked       = status.enabled;
  document.getElementById('sched-frequency').value       = status.frequency || 'daily';
  document.getElementById('sched-include-diff').checked  = status.includeDiff;
  document.getElementById('sched-dest-display').textContent = status.destDir || 'Not set';

  const lastRun = _fmtSchedDate(status.lastRun);
  const nextRun = status.enabled && status.nextRun ? _fmtSchedDate(status.nextRun) : 'Not scheduled';
  document.getElementById('sched-status-line').textContent =
    `Last run: ${lastRun}  ·  Next run: ${nextRun}`;

  await renderSchedHistory();
}

async function renderSchedHistory() {
  const panel = document.getElementById('sched-history-panel');
  const records = await window.neurologue.schedulerHistory(20);
  panel.innerHTML = '';
  if (!records || records.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'worker-log-empty';
    empty.textContent = 'No exports recorded yet.';
    panel.appendChild(empty);
    return;
  }
  [...records].reverse().forEach((r) => {
    const row = document.createElement('div');
    row.className = 'sched-history-row';

    const icon = document.createElement('span');
    icon.className = r.ok ? 'sched-ok' : 'sched-fail';
    icon.textContent = r.ok ? '✓' : '✗';
    row.appendChild(icon);

    const ts = document.createElement('span');
    ts.textContent = _fmtSchedDate(r.runAt);
    row.appendChild(ts);

    const dir = document.createElement('span');
    const name = r.snapshotDir ? r.snapshotDir.split(/[\\/]/).pop() : '—';
    dir.textContent = name;
    dir.title = r.snapshotDir || '';
    row.appendChild(dir);

    panel.appendChild(row);
  });
}

async function _saveSchedConfig() {
  const cfg = {
    enabled:     document.getElementById('sched-enabled').checked,
    frequency:   document.getElementById('sched-frequency').value,
    destDir:     _schedConfig.destDir || null,
    includeDiff: document.getElementById('sched-include-diff').checked,
    lastRun:     _schedConfig.lastRun || null,
  };
  _schedConfig = { ..._schedConfig, ...cfg };
  await window.neurologue.schedulerSaveConfig(cfg);
}

document.getElementById('sched-enabled').addEventListener('change', _saveSchedConfig);
document.getElementById('sched-frequency').addEventListener('change', _saveSchedConfig);
document.getElementById('sched-include-diff').addEventListener('change', _saveSchedConfig);

document.getElementById('btn-sched-choose-folder').addEventListener('click', async () => {
  const result = await window.neurologue.schedulerChooseFolder();
  if (result.canceled) return;
  _schedConfig.destDir = result.path;
  document.getElementById('sched-dest-display').textContent = result.path;
  await _saveSchedConfig();
});

document.getElementById('btn-sched-run-now').addEventListener('click', async () => {
  const btn = document.getElementById('btn-sched-run-now');
  const feedback = document.getElementById('sched-run-feedback');
  btn.disabled = true;
  btn.textContent = 'Running…';
  feedback.textContent = '';
  try {
    const result = await window.neurologue.schedulerRunNow();
    if (result.ok) {
      feedback.textContent = `✓ Snapshot saved to ${result.snapshotDir.split(/[\\/]/).pop()}`;
    } else {
      feedback.textContent = `✗ ${result.error || 'Export failed'}`;
    }
    await loadSchedSettings();
  } catch (err) {
    feedback.textContent = `✗ ${err.message || 'Unexpected error'}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export now';
  }
});

document.getElementById('btn-sched-refresh-history').addEventListener('click', renderSchedHistory);

// Load scheduled export settings when that tab is activated
document.querySelectorAll('.settings-tab').forEach((tab) => {
  if (tab.dataset.tab === 'scheduled-export') {
    tab.addEventListener('click', loadSchedSettings);
  }
});

// ── Tag Management modal ─────────────────────────────────────────────────────

const tagMgmtModal    = document.getElementById('tag-management-modal');
const tagMgmtClose    = document.getElementById('tag-management-close');
const tagSimilarSec   = document.getElementById('tag-similar-section');
const tagSimilarList  = document.getElementById('tag-similar-list');
const tagAllList      = document.getElementById('tag-all-list');
const tagMgmtEmpty    = document.getElementById('tag-mgmt-empty');

document.getElementById('btn-maintenance').addEventListener('click', openTagManagement);
tagMgmtClose.addEventListener('click', () => tagMgmtModal.classList.add('hidden'));
tagMgmtModal.addEventListener('click', (e) => {
  if (e.target === tagMgmtModal) tagMgmtModal.classList.add('hidden');
});

async function openTagManagement() {
  tagSimilarSec.classList.add('hidden');
  tagSimilarList.innerHTML = '';
  tagAllList.innerHTML = '';
  tagMgmtEmpty.classList.add('hidden');
  tagMgmtModal.classList.remove('hidden');
  await refreshTagManagement();
}

async function refreshTagManagement() {
  const [tags, similar] = await Promise.all([
    window.neurologue.listTagsWithCounts(),
    window.neurologue.similarTags(),
  ]);

  // Similar pairs
  if (similar.length > 0) {
    tagSimilarSec.classList.remove('hidden');
    tagSimilarList.innerHTML = '';
    similar.forEach((pair) => renderSimilarPair(pair));
  } else {
    tagSimilarSec.classList.add('hidden');
  }

  // All tags
  tagAllList.innerHTML = '';
  if (tags.length === 0) {
    tagMgmtEmpty.classList.remove('hidden');
  } else {
    tagMgmtEmpty.classList.add('hidden');
    tags.forEach((tag) => tagAllList.appendChild(buildTagRow(tag)));
  }
}

function renderSimilarPair(pair) {
  // Sort so highest count is first
  const [first, second] = pair.a.count >= pair.b.count ? [pair.a, pair.b] : [pair.b, pair.a];

  const row = document.createElement('div');
  row.className = 'tag-similar-pair';
  row.dataset.pairA = pair.a.id;
  row.dataset.pairB = pair.b.id;

  const noteWord = (n) => n === 1 ? '1 note' : `${n} notes`;

  const reasonLabels = {
    'format-variant':   'Format variant',
    'prefix-variant':   'Abbreviation',
    'similar-spelling': 'Spelling',
    'similar-meaning':  pair.similarity ? `Similar meaning \u00b7 ${pair.similarity}%` : 'Similar meaning',
  };
  const reasonLabel = reasonLabels[pair.reason] || pair.reason || '';
  const reasonClass = pair.reason === 'similar-meaning' ? 'tag-similar-reason--semantic' : 'tag-similar-reason--structural';

  row.innerHTML = `
    <div class="tag-similar-tag">
      <span class="tag-similar-name">#${first.name}</span>
      <span class="tag-similar-count">${noteWord(first.count)}</span>
    </div>
    <span class="tag-similar-sep">↔</span>
    <div class="tag-similar-tag">
      <span class="tag-similar-name">#${second.name}</span>
      <span class="tag-similar-count">${noteWord(second.count)}</span>
    </div>
    <span class="tag-similar-reason ${reasonClass}">${reasonLabel}</span>
    <div class="tag-similar-actions">
      <button class="btn-keep-tag" data-keep="${first.id}" data-remove="${second.id}" title="Keep #${first.name}, merge #${second.name} into it">Keep #${first.name}</button>
      <button class="btn-keep-tag" data-keep="${second.id}" data-remove="${first.id}" title="Keep #${second.name}, merge #${first.name} into it">Keep #${second.name}</button>
      <button class="btn-skip-pair">Skip</button>
    </div>
  `;

  row.querySelectorAll('.btn-keep-tag').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const keepId   = btn.dataset.keep;
      const removeId = btn.dataset.remove;
      // Disable all actions while the merge + rescan runs
      row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      row.querySelector('.tag-similar-reason').textContent = 'Merging…';
      const res = await window.neurologue.mergeTag(removeId, keepId);
      if (res.ok) {
        // Full rescan: removes stale pairs that referenced the deleted tag,
        // rebuilds both sections, updates the all-tags list and sidebar
        await refreshTagManagement();
        await loadTags();
      } else {
        // Re-enable on failure
        row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        row.querySelector('.tag-similar-reason').textContent = 'Error — try again';
      }
    });
  });

  row.querySelector('.btn-skip-pair').addEventListener('click', () => {
    row.remove();
    if (tagSimilarList.children.length === 0) tagSimilarSec.classList.add('hidden');
  });

  tagSimilarList.appendChild(row);
}

function buildTagRow(tag) {
  const row = document.createElement('div');
  row.className = 'tag-row';
  row.dataset.tagId = tag.id;

  const noteWord = (n) => n === 1 ? '1 note' : `${n} notes`;

  row.innerHTML = `
    <span class="tag-row-name">#${tag.name}</span>
    <span class="tag-row-count">${noteWord(tag.count)}</span>
    <div class="tag-row-actions">
      <button class="btn-rename-tag">Rename</button>
      <button class="btn-delete-tag">Delete</button>
    </div>
  `;

  row.querySelector('.btn-rename-tag').addEventListener('click', () => startRename(row, tag));
  row.querySelector('.btn-delete-tag').addEventListener('click', () => startDelete(row, tag));

  return row;
}

function startRename(row, tag) {
  const nameEl    = row.querySelector('.tag-row-name');
  const countEl   = row.querySelector('.tag-row-count');
  const actionsEl = row.querySelector('.tag-row-actions');

  nameEl.classList.add('hidden');
  actionsEl.classList.add('hidden');

  const renameEl = document.createElement('div');
  renameEl.className = 'tag-row-rename';
  renameEl.innerHTML = `
    <input type="text" value="${tag.name}" autocomplete="off" spellcheck="false" />
    <button class="btn-rename-save">Save</button>
    <button class="btn-rename-cancel">Cancel</button>
  `;
  row.insertBefore(renameEl, countEl);

  const input = renameEl.querySelector('input');
  input.focus();
  input.select();

  const cancel = () => {
    renameEl.remove();
    nameEl.classList.remove('hidden');
    actionsEl.classList.remove('hidden');
  };

  const save = async () => {
    const newName = input.value.trim();
    if (!newName || newName === tag.name) { cancel(); return; }
    const res = await window.neurologue.renameTag(tag.id, newName);
    if (res.ok) {
      tag.name = newName.toLowerCase();
      nameEl.textContent = `#${tag.name}`;
      cancel();
      await loadTags(); // refresh sidebar
    } else {
      input.style.borderColor = 'var(--danger)';
      input.title = res.error || 'Could not rename';
    }
  };

  renameEl.querySelector('.btn-rename-save').addEventListener('click', save);
  renameEl.querySelector('.btn-rename-cancel').addEventListener('click', cancel);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') cancel();
  });
}

function startDelete(row, tag) {
  const actionsEl = row.querySelector('.tag-row-actions');
  row.classList.add('tag-row--confirm-delete');
  actionsEl.innerHTML = `
    <button class="btn-confirm-delete">Delete</button>
    <button class="btn-cancel-delete">Cancel</button>
  `;
  actionsEl.querySelector('.btn-confirm-delete').addEventListener('click', async () => {
    const res = await window.neurologue.deleteTag(tag.id);
    if (res.ok) {
      // Full rescan so any similar-pair rows referencing this tag are removed
      await refreshTagManagement();
      await loadTags();
    }
  });
  actionsEl.querySelector('.btn-cancel-delete').addEventListener('click', () => {
    row.classList.remove('tag-row--confirm-delete');
    row.querySelector('.tag-row-actions').innerHTML = `
      <button class="btn-rename-tag">Rename</button>
      <button class="btn-delete-tag">Delete</button>
    `;
    row.querySelector('.btn-rename-tag').addEventListener('click', () => startRename(row, tag));
    row.querySelector('.btn-delete-tag').addEventListener('click', () => startDelete(row, tag));
  });
}

// ── Startup setup check ────────────────────────────────────────────

// True if a model name from settings matches one of the available model strings
function modelAvailable(model, available) {
  const base = model.split(':')[0];
  return available.some((a) => a === model || a.split(':')[0] === base);
}

async function runModelCheck(status) {
  const settings = await window.neurologue.getSettings();
  const required = [settings.embeddingModel, settings.llmModel];
  const missing  = required.filter((m) => !modelAvailable(m, status.ollama.availableModels));
  if (missing.length > 0) {
    showSetupModal('models', { missing });
  } else {
    hideSetupModal();
  }
}

async function runSetupCheck() {
  try {
    const status = await window.neurologue.getStatus();
    updateStatus(status);

    if (!status.ollama.running) {
      const installed = await window.neurologue.checkOllamaInstalled();
      showSetupModal(installed.installed ? 'start' : 'install');
      return;
    }

    await runModelCheck(status);
  } catch (err) {
    console.error('[library] setup check failed:', err);
  }
}

// ── Nav rail / view routing ──────────────────────────────────────────

const navItems        = document.querySelectorAll('.nav-item');
const views           = document.querySelectorAll('.view');
const libraryOnlyEls  = document.querySelectorAll('.toolbar-library-only');

function activateView(viewId) {
  navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewId));
  views.forEach(v   => v.classList.toggle('active-view', v.id === `view-${viewId}`));

  const isLibrary = viewId === 'library';
  libraryOnlyEls.forEach(el => el.classList.toggle('hidden-for-view', !isLibrary));

  if (viewId === 'themes')         loadThemesView();
  if (viewId === 'contradictions') loadContradictionsView();
  if (viewId === 'priorities')     loadPrioritiesView();
  if (viewId === 'explore')        loadDashboardView();
  if (viewId === 'graph')          loadGraphView();
  if (viewId === 'replay')         loadReplayView();
  if (viewId === 'agents')         loadAgentsView();
  // Destroy graph renderer when leaving the graph view
  if (viewId !== 'graph')          _destroyGraphIfActive();
}

navItems.forEach(btn => {
  btn.addEventListener('click', () => activateView(btn.dataset.view));
});

// ── Themes view controller ───────────────────────────────────────────────────

const themesListEl       = document.getElementById('themes-list');
const themesListCountEl  = document.getElementById('themes-list-count');
const themesDetailPh     = document.getElementById('themes-detail-placeholder');
const themesDetailCont   = document.getElementById('themes-detail-content');
const themesDetailName   = document.getElementById('themes-detail-name');
const themesDetailSum    = document.getElementById('themes-detail-summary');
const themesEntriesList  = document.getElementById('themes-entries-list');
const themesNameRow      = document.getElementById('themes-detail-name-row');
const themesRenameForm   = document.getElementById('themes-rename-form');
const themesRenameInput  = document.getElementById('themes-rename-input');
const themesBtnRename    = document.getElementById('themes-btn-rename');
const themesRenameSave   = document.getElementById('themes-rename-save');
const themesRenameCancel = document.getElementById('themes-rename-cancel');
const themesLifespanRow  = document.getElementById('themes-lifespan-row');
const themesSparklineWrap = document.getElementById('themes-sparkline-wrap');
const themesSparkline    = document.getElementById('themes-sparkline');

let _themesActiveId = null;
let _themesFilter   = 0; // 0 = all, 7 = last 7 days, 30 = last 30 days

// Filter bar click handlers
document.querySelectorAll('.themes-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _themesFilter = parseInt(btn.dataset.days, 10) || 0;
    document.querySelectorAll('.themes-filter-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    loadThemesView();
  });
});

/**
 * Compute first-seen / last-active / status from a theme's entries array.
 * Returns null if there are no entries with parseable dates.
 */
function computeLifespan(entries) {
  if (!entries || entries.length === 0) return null;
  const times = entries
    .map((e) => new Date(e.created_at))
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.getTime());
  if (times.length === 0) return null;
  const first = new Date(Math.min(...times));
  const last  = new Date(Math.max(...times));
  const daysSinceLast = (Date.now() - last.getTime()) / 86400000;
  const spanDays      = (last.getTime() - first.getTime()) / 86400000;
  let status, statusClass;
  if (daysSinceLast < 14)      { status = 'Active';  statusClass = 'active';  }
  else if (daysSinceLast < 60) { status = 'Fading';  statusClass = 'fading';  }
  else                         { status = 'Dormant'; statusClass = 'dormant'; }
  let event = null;
  if (first.getTime() > Date.now() - 14 * 86400000) event = 'Newly formed';
  else if (spanDays < 7 && entries.length >= 5)      event = 'Concentrated burst';
  return { first, last, status, statusClass, event };
}

/** Draw an SVG area + line sparkline into container from { weeksAgo, count }[] data. */
function renderSparkline(container, data) {
  if (!data || data.every((d) => d.count === 0)) {
    container.innerHTML = '<span class="sparkline-empty">No activity in this period</span>';
    return;
  }
  // Use a fixed viewBox coordinate space; SVG stretches to container width via CSS.
  const VW = 300, VH = 64, PAD_X = 6, PAD_Y = 8;
  const max = Math.max(...data.map((d) => d.count), 1);
  const n = data.length;
  const pts = data.map((d, i) => {
    const x = PAD_X + (n <= 1 ? (VW - PAD_X * 2) / 2 : (i / (n - 1)) * (VW - PAD_X * 2));
    const y = PAD_Y + (1 - d.count / max) * (VH - PAD_Y * 2);
    return [+x.toFixed(1), +y.toFixed(1)];
  });
  const polyPts = pts.map(([x, y]) => `${x},${y}`).join(' ');
  const bx = pts[0][0], ex = pts[pts.length - 1][0], floor = VH - PAD_Y;
  const areaPath = `M${bx},${floor} ${pts.map(([x, y]) => `L${x},${y}`).join(' ')} L${ex},${floor} Z`;
  // Dot markers at each data point
  const dots = pts
    .map(([x, y], i) => data[i].count > 0
      ? `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--cortex-teal)"/>` : '')
    .join('');
  // Baseline rule
  const baseline = `<line x1="${bx}" y1="${floor}" x2="${ex}" y2="${floor}" stroke="var(--border)" stroke-width="1"/>`;
  container.innerHTML =
    `<svg width="100%" height="${VH}" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none">` +
    baseline +
    `<path d="${areaPath}" fill="var(--cortex-teal)" fill-opacity="0.25"/>` +
    `<polyline points="${polyPts}" fill="none" stroke="var(--cortex-teal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    dots +
    `</svg>`;
}

async function loadThemesView() {
  try {
    let themes = await window.neurologue.listThemes();
    const countKey = _themesFilter === 7 ? 'count_7d' : 'count_30d';

    // When a time filter is active: sort by recent activity, dim zero-activity entries
    if (_themesFilter > 0) {
      themes = [...themes].sort((a, b) =>
        (b[countKey] || 0) - (a[countKey] || 0) || b.entry_count - a.entry_count
      );
    }

    const activeCount = _themesFilter > 0
      ? themes.filter((t) => (t[countKey] || 0) > 0).length
      : themes.length;

    themesListCountEl.textContent = themes.length
      ? (_themesFilter > 0 ? `${activeCount} of ${themes.length} active` : `${themes.length} themes`)
      : '';

    themesListEl.innerHTML = '';

    if (themes.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 14px;font-size:13px;color:var(--text-dim)';
      empty.textContent = 'No themes yet — clustering runs automatically as you add entries.';
      themesListEl.appendChild(empty);
      return;
    }

    themes.forEach((theme) => {
      const recentCount = _themesFilter > 0 ? (theme[countKey] || 0) : null;
      const isDimmed    = _themesFilter > 0 && recentCount === 0;
      const item = document.createElement('div');
      item.className = 'themes-list-item' +
        (theme.id === _themesActiveId ? ' active' : '') +
        (isDimmed ? ' dimmed' : '');
      item.dataset.id = theme.id;
      const entryWord  = theme.entry_count === 1 ? '1 entry' : `${theme.entry_count} entries`;
      const recentStr  = recentCount !== null && recentCount > 0 ? ` · ${recentCount} recent` : '';
      item.innerHTML =
        `<div class="tli-name">${escHtml(theme.display_name || theme.name)}</div>` +
        `<div class="tli-meta">${entryWord}${recentStr}</div>`;
      item.addEventListener('click', () => selectThemeView(theme.id));
      themesListEl.appendChild(item);
    });

    // If we had an active theme, re-select it so detail stays fresh
    if (_themesActiveId) selectThemeView(_themesActiveId);
  } catch (err) {
    console.error('[themes-view] loadThemesView failed:', err);
  }
}

async function selectThemeView(id) {
  _themesActiveId = id;
  document.querySelectorAll('.themes-list-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  closeRenameForm();

  try {
    const theme = await window.neurologue.getTheme(id);
    if (!theme) return;

    const displayName = theme.display_name || theme.name;
    themesDetailName.textContent = displayName;
    themesDetailSum.textContent = theme.description ||
      'No summary yet — clustering will generate one when Ollama is available.';

    // Populate entries
    themesEntriesList.innerHTML = '';
    (theme.entries || []).slice(0, 30).forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'themes-entry-card';
      card.innerHTML =
        `<div class="tec-meta">` +
        `<span class="tec-date">${formatDate(entry.created_at)}</span>` +
        `<span class="tec-score">${entry.score !== undefined ? entry.score.toFixed(2) : ''}</span>` +
        `</div>` +
        `<div class="tec-preview">${escHtml(entry.content)}</div>`;
      card.addEventListener('click', () => {
        // Jump to Library view + entry
        activateView('library');
        selectEntry(entry.id);
      });
      themesEntriesList.appendChild(card);
    });

    // Lifespan (computed from ALL entries, not just the first 30)
    const lifespan = computeLifespan(theme.entries);
    if (lifespan) {
      const eventBit = lifespan.event
        ? `<span class="tls-event">· ${lifespan.event}</span>`
        : '';
      themesLifespanRow.innerHTML =
        `<span class="tls-first">Born ${formatDate(lifespan.first.toISOString())}</span>` +
        `<span class="tls-sep">·</span>` +
        `<span class="tls-last">Last active ${formatDate(lifespan.last.toISOString())}</span>` +
        `<span class="tls-badge tls-${lifespan.statusClass}">${lifespan.status}</span>` +
        eventBit;
      themesLifespanRow.classList.remove('hidden');
    } else {
      themesLifespanRow.classList.add('hidden');
    }

    // Sparkline — fetch weekly activity for last 12 weeks
    try {
      const activity = await window.neurologue.getThemeWeeklyActivity(id, 12);
      renderSparkline(themesSparkline, activity);
      themesSparklineWrap.classList.remove('hidden');
    } catch {
      themesSparklineWrap.classList.add('hidden');
    }

    themesDetailPh.style.display   = 'none';
    themesDetailCont.style.display = 'flex';
  } catch (err) {
    console.error('[themes-view] selectThemeView failed:', err);
  }
}

// ── Rename flow ──────────────────────────────────────────────────────────────

function openRenameForm() {
  const currentName = themesDetailName.textContent;
  themesRenameInput.value = currentName;
  themesNameRow.style.display      = 'none';
  themesRenameForm.style.display   = 'flex';
  themesRenameInput.focus();
  themesRenameInput.select();
}

function closeRenameForm() {
  themesRenameForm.style.display = 'none';
  themesNameRow.style.display    = 'flex';
  themesRenameInput.value        = '';
}

async function saveRename() {
  const newName = themesRenameInput.value.trim();
  if (!newName || !_themesActiveId) { closeRenameForm(); return; }

  themesRenameSave.disabled = true;
  themesRenameSave.textContent = 'Saving…';
  try {
    await window.neurologue.renameTheme(_themesActiveId, newName);
    closeRenameForm();
    await loadThemesView();
  } catch (err) {
    console.error('[themes-view] rename failed:', err);
    themesRenameInput.style.borderColor = 'var(--danger)';
  } finally {
    themesRenameSave.disabled = false;
    themesRenameSave.textContent = 'Save';
  }
}

themesBtnRename.addEventListener('click', openRenameForm);
themesRenameSave.addEventListener('click', saveRename);
themesRenameCancel.addEventListener('click', closeRenameForm);
themesRenameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  saveRename();
  if (e.key === 'Escape') closeRenameForm();
});

document.getElementById('themes-btn-delete').addEventListener('click', async () => {
  if (!_themesActiveId) return;
  const name = themesDetailName.textContent || 'this theme';
  const confirmed = confirm(`Delete theme "${name}"?\n\nThe entries will not be deleted, but theme assignments will be removed.`);
  if (!confirmed) return;
  const result = await window.neurologue.deleteTheme(_themesActiveId);
  if (!result.ok) { alert(`Delete failed: ${result.error}`); return; }
  _themesActiveId = null;
  // Hide detail panel and reload list
  themesDetailCont.style.display = 'none';
  themesDetailPh.style.display   = '';
  await loadThemesView();
});

// ── Contradictions view controller ──────────────────────────────────────────

const contradictionsListEl       = document.getElementById('contradictions-list');
const contradictionsListCountEl  = document.getElementById('contradictions-list-count');
const contradictionsDetailPh     = document.getElementById('contradictions-detail-placeholder');
const contradictionsDetailCont   = document.getElementById('contradictions-detail-content');
const contradictionsDetailMeta   = document.getElementById('contradictions-detail-meta');
const contradictionsStatusBadge  = document.getElementById('contradictions-detail-status-badge');
const contradictionsDetailTheme  = document.getElementById('contradictions-detail-theme');
const contradictionsDetailDate   = document.getElementById('contradictions-detail-date');
const contradictionEntryA        = document.getElementById('contradiction-entry-a');
const contradictionEntryB        = document.getElementById('contradiction-entry-b');
const contradictionsActiveActs   = document.getElementById('contradictions-active-actions');
const contradictionsResolvedMsg  = document.getElementById('contradictions-resolved-msg');
const contradictionResolvedLabel = document.getElementById('contradiction-resolved-label');
const contradictionResolvedNotes = document.getElementById('contradiction-resolved-notes');
const contradictionNotesInput    = document.getElementById('contradiction-resolve-notes');
const btnResolve                 = document.getElementById('btn-resolve-contradiction');
const btnDismiss                 = document.getElementById('btn-dismiss-contradiction');
const btnScan                    = document.getElementById('btn-scan-contradictions');

let _contradictionsFilter   = 'active';
let _contradictionsActiveId = null;

// Filter tab clicks
document.querySelectorAll('.contradictions-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    _contradictionsFilter = btn.dataset.status;
    document.querySelectorAll('.contradictions-filter-btn').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    _contradictionsActiveId = null;
    loadContradictionsView();
  });
});

async function loadContradictionsView() {
  try {
    const items = await window.neurologue.listContradictions({ status: _contradictionsFilter });
    contradictionsListCountEl.textContent = items.length ? `${items.length}` : '';
    contradictionsListEl.innerHTML = '';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 14px;font-size:13px;color:var(--text-dim)';
      empty.textContent = _contradictionsFilter === 'active'
        ? 'No active conflicts detected yet.'
        : 'None here.';
      contradictionsListEl.appendChild(empty);
      if (_contradictionsActiveId) {
        _contradictionsActiveId = null;
        showContradictionPlaceholder();
      }
      return;
    }

    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'contradiction-list-item' +
        (item.id === _contradictionsActiveId ? ' active' : '');
      el.dataset.id = item.id;
      const preview = escHtml((item.entry_a_content || '').slice(0, 60));
      const themeStr = item.theme_name
        ? `<span class="cli-theme">${escHtml(item.theme_name)}</span>` : '';
      el.innerHTML =
        `<div class="cli-preview">${preview}\u2026</div>` +
        `<div class="cli-meta">${formatDate(item.detected_at)}${item.theme_name ? ' · ' : ''}${themeStr}</div>`;
      el.addEventListener('click', () => selectContradict(item));
      contradictionsListEl.appendChild(el);
    });

    // Re-select the active item if it still exists
    if (_contradictionsActiveId) {
      const still = items.find((i) => i.id === _contradictionsActiveId);
      if (still) selectContradict(still);
      else showContradictionPlaceholder();
    }
  } catch (err) {
    console.error('[contradictions-view] loadContradictionsView failed:', err);
  }
}

function showContradictionPlaceholder() {
  contradictionsDetailPh.style.display   = '';
  contradictionsDetailCont.style.display = 'none';
}

function selectContradict(item) {
  _contradictionsActiveId = item.id;
  document.querySelectorAll('.contradiction-list-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === item.id);
  });

  // Status badge
  contradictionsStatusBadge.textContent  = item.status;
  contradictionsStatusBadge.className    = `cd-status-badge cd-status-${item.status}`;
  contradictionsDetailTheme.textContent  = item.theme_name ? `Theme: ${item.theme_name}` : '';
  contradictionsDetailDate.textContent   = `Detected ${formatDate(item.detected_at)}`;

  // Entry cards
  _renderEntryCard(contradictionEntryA, item.entry_a_id, item.entry_a_content, item.entry_a_created_at);
  _renderEntryCard(contradictionEntryB, item.entry_b_id, item.entry_b_content, item.entry_b_created_at);

  // Actions
  if (item.status === 'active') {
    contradictionNotesInput.value        = '';
    contradictionsActiveActs.style.display  = 'flex';
    contradictionsResolvedMsg.classList.add('hidden');
  } else {
    contradictionsActiveActs.style.display  = 'none';
    contradictionsResolvedMsg.classList.remove('hidden');
    contradictionResolvedLabel.textContent = item.status === 'resolved' ? 'Resolved' : 'Dismissed';
    contradictionResolvedNotes.textContent = item.resolution_notes || '';
  }

  contradictionsDetailPh.style.display   = 'none';
  contradictionsDetailCont.style.display = 'flex';
}

function _renderEntryCard(container, entryId, content, createdAt) {
  container.innerHTML =
    `<div class="cec-date">${formatDate(createdAt)}</div>` +
    `<div class="cec-content">${escHtml((content || '').slice(0, 600))}</div>` +
    `<span class="cec-jump" data-id="${escHtml(entryId)}">Open in Library →</span>`;
  container.querySelector('.cec-jump').addEventListener('click', () => {
    activateView('library');
    selectEntry(entryId);
  });
}

btnResolve.addEventListener('click', async () => {
  if (!_contradictionsActiveId) return;
  btnResolve.disabled = true;
  btnResolve.textContent = 'Saving…';
  try {
    await window.neurologue.resolveContradiction(_contradictionsActiveId, contradictionNotesInput.value);
    await loadContradictionsView();
  } finally {
    btnResolve.disabled = false;
    btnResolve.textContent = 'Mark resolved';
  }
});

btnDismiss.addEventListener('click', async () => {
  if (!_contradictionsActiveId) return;
  btnDismiss.disabled = true;
  try {
    await window.neurologue.dismissContradiction(_contradictionsActiveId);
    await loadContradictionsView();
  } finally {
    btnDismiss.disabled = false;
  }
});

btnScan.addEventListener('click', async () => {
  btnScan.disabled = true;
  btnScan.textContent = 'Scanning…';
  try {
    const result = await window.neurologue.scanContradictions();
    btnScan.textContent = result.found > 0
      ? `Found ${result.found} new`
      : 'No new conflicts';
    if (result.found > 0) await loadContradictionsView();
  } catch {
    btnScan.textContent = 'Scan failed';
  } finally {
    setTimeout(() => {
      btnScan.disabled = false;
      btnScan.textContent = 'Scan now';
    }, 2500);
  }
});

// ── Priorities view controller ───────────────────────────────────────────────

const priListEl           = document.getElementById('pri-list');
const priListCountEl      = document.getElementById('pri-list-count');
const priNeglectedBanner  = document.getElementById('pri-neglected-banner');
const priDetailPh         = document.getElementById('pri-detail-placeholder');
const priDetailCont       = document.getElementById('pri-detail-content');
const priDetailName       = document.getElementById('pri-detail-name');
const priDetailDriftBadge = document.getElementById('pri-detail-drift-badge');
const priDetailBadge      = document.getElementById('pri-detail-priority-badge');
const priBarE             = document.getElementById('pri-bar-e');
const priBarV             = document.getElementById('pri-bar-v');
const priBarO             = document.getElementById('pri-bar-o');
const priBarM             = document.getElementById('pri-bar-m');
const priValE             = document.getElementById('pri-val-e');
const priValV             = document.getElementById('pri-val-v');
const priValO             = document.getElementById('pri-val-o');
const priValM             = document.getElementById('pri-val-m');
const priQDots            = document.getElementById('pri-quadrant-dots');
const priOpenLoops        = document.getElementById('pri-open-loops');
const priEntriesCount     = document.getElementById('pri-entries-count');
const priComputedAt       = document.getElementById('pri-computed-at');
const btnPriRecompute     = document.getElementById('btn-pri-recompute');
const priSparkEnergy      = document.getElementById('pri-spark-energy');
const priSparkPriority    = document.getElementById('pri-spark-priority');
const priDriftAlert       = document.getElementById('pri-drift-neglect-alert');

let _priActiveId = null;
let _priAllMetrics = [];

const DRIFT_LABELS = { rising: '↑ Rising', falling: '↓ Falling', neglected: '⚠ Neglected', stable: '→ Stable' };
const DRIFT_CLASSES = { rising: 'pri-drift-rising', falling: 'pri-drift-falling', neglected: 'pri-drift-neglected', stable: 'pri-drift-stable' };

function _pct(v) { return `${Math.round((v || 0) * 100)}%`; }

/** Render an SVG polyline points string from an array of 0–1 values into a 200×50 viewBox */
function _sparkPoints(values) {
  if (!values || values.length === 0) return '';
  const w = 200; const h = 50; const pad = 4;
  const xs = values.length === 1
    ? [w / 2]
    : values.map((_, i) => pad + (i / (values.length - 1)) * (w - pad * 2));
  return values.map((v, i) => `${xs[i].toFixed(1)},${(pad + (1 - (v || 0)) * (h - pad * 2)).toFixed(1)}`).join(' ');
}

function _showPriDetail(metrics) {
  _priActiveId = metrics.theme_id;
  priDetailPh.style.display = 'none';
  priDetailCont.style.display = '';

  priDetailName.textContent = metrics.theme_name || 'Unnamed';

  // Priority badge
  const pct = Math.round((metrics.priority_score || 0) * 100);
  priDetailBadge.textContent = `Priority ${pct}%`;

  // Drift badge
  const drift = metrics.drift || 'stable';
  priDetailDriftBadge.textContent  = DRIFT_LABELS[drift] || drift;
  priDetailDriftBadge.className    = `pri-drift-badge ${DRIFT_CLASSES[drift] || DRIFT_CLASSES.stable}`;

  // Neglected alert
  priDriftAlert.classList.toggle('hidden', drift !== 'neglected');

  // EVOM bars
  priBarE.style.width = _pct(metrics.energy_score);
  priBarV.style.width = _pct(metrics.value_alignment_score);
  priBarO.style.width = _pct(metrics.obligation_score);
  priBarM.style.width = _pct(metrics.motivation_score);
  priValE.textContent = _pct(metrics.energy_score);
  priValV.textContent = _pct(metrics.value_alignment_score);
  priValO.textContent = _pct(metrics.obligation_score);
  priValM.textContent = _pct(metrics.motivation_score);

  // Drift sparkline
  const history = metrics.history || [];
  priSparkEnergy.setAttribute('points',   _sparkPoints(history.map((h) => h.energy_score)));
  priSparkPriority.setAttribute('points', _sparkPoints(history.map((h) => h.priority_score)));

  // Quadrant dots — plot all themes; highlight selected
  priQDots.innerHTML = '';
  for (const m of _priAllMetrics) {
    const dot = document.createElement('div');
    dot.className = 'pri-q-dot' + (m.theme_id === metrics.theme_id ? ' pri-q-dot-active' : '');
    const x = (m.energy_score || 0) * 100;
    const y = (1 - (m.value_alignment_score || 0)) * 100;
    dot.style.left = `${x}%`;
    dot.style.top  = `${y}%`;
    dot.title = m.theme_name || 'Unnamed';
    dot.addEventListener('click', () => _selectPriTheme(m.theme_id));
    priQDots.appendChild(dot);
  }

  priOpenLoops.textContent    = metrics.open_loops_count ?? '—';
  priEntriesCount.textContent = metrics.entries_count ?? '—';
  priComputedAt.textContent   = metrics.computed_at
    ? new Date(metrics.computed_at).toLocaleString()
    : '—';

  // Highlight active row
  priListEl.querySelectorAll('.pri-theme-row').forEach((row) => {
    row.classList.toggle('active', row.dataset.themeId === metrics.theme_id);
  });
}

function _selectPriTheme(themeId) {
  const m = _priAllMetrics.find((x) => x.theme_id === themeId);
  if (m) _showPriDetail(m);
}

async function loadPrioritiesView() {
  try {
    const metrics = await window.neurologue.listPriorityMetrics();
    _priAllMetrics = metrics;
    priListCountEl.textContent = metrics.length ? `(${metrics.length})` : '';

    // Neglected banner
    const neglected = metrics.filter((m) => m.drift === 'neglected');
    if (neglected.length > 0) {
      priNeglectedBanner.textContent = `⚠ ${neglected.length} neglected obligation${neglected.length > 1 ? 's' : ''}: ${neglected.map((m) => m.theme_name).join(', ')}`;
      priNeglectedBanner.classList.remove('hidden');
    } else {
      priNeglectedBanner.classList.add('hidden');
    }

    priListEl.innerHTML = '';
    if (metrics.length === 0) {
      priListEl.innerHTML = '<div class="pri-no-data">No priority data yet.<br>The worker computes scores after clustering.</div>';
      priDetailPh.style.display = '';
      priDetailCont.style.display = 'none';
      return;
    }

    metrics.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'pri-theme-row';
      row.dataset.themeId = m.theme_id;
      if (m.theme_id === _priActiveId) row.classList.add('active');

      const pct = Math.round((m.priority_score || 0) * 100);
      const drift = m.drift || 'stable';
      const driftIcon = { rising: '↑', falling: '↓', neglected: '⚠', stable: '' }[drift] || '';
      row.innerHTML = `
        <span class="pri-rank-badge">#${i + 1}</span>
        <div class="pri-theme-info">
          <div class="pri-theme-name">${m.theme_name || 'Unnamed'}</div>
          <div class="pri-theme-subtitle">${pct}% priority · ${m.entries_count ?? 0} entries</div>
        </div>
        ${driftIcon ? `<span class="pri-drift-badge ${DRIFT_CLASSES[drift]}">${driftIcon}</span>` : ''}
        <div class="pri-mini-bar-wrap">
          <div class="pri-mini-bar" style="width:${pct}%"></div>
        </div>`;
      row.addEventListener('click', () => _showPriDetail(m));
      priListEl.appendChild(row);
    });

    // Re-show active detail or auto-select first
    const active = _priActiveId ? metrics.find((m) => m.theme_id === _priActiveId) : null;
    if (active) {
      _showPriDetail(active);
    } else if (metrics.length > 0) {
      _showPriDetail(metrics[0]);
    }
  } catch (err) {
    console.error('[priorities-view] loadPrioritiesView failed:', err);
  }
}

btnPriRecompute.addEventListener('click', async () => {
  btnPriRecompute.disabled = true;
  btnPriRecompute.textContent = '…';
  try {
    await window.neurologue.recomputePriorities();
    await loadPrioritiesView();
  } catch {
    // error shown via IPC error toast
  } finally {
    btnPriRecompute.disabled = false;
    btnPriRecompute.textContent = '↻';
  }
});

// ── Knowledge Graph view controller ─────────────────────────────────────────

let _graphInitialised = false;

function _destroyGraphIfActive() {
  if (_graphInitialised) {
    window.graphView.graphDestroy();
    _graphInitialised = false;
  }
}

async function loadGraphView() {
  // Initialise the renderer once
  if (!_graphInitialised) {
    window.graphView.graphInit(graphContainer, (themeId) => {
      // Navigate to Themes view and select the clicked theme
      activateView('themes');
      selectThemeView(themeId);
    });
    _graphInitialised = true;
  }

  graphNodeCount.textContent = 'Loading…';
  btnGraphRefresh.disabled   = true;

  try {
    const data = await window.neurologue.getGraphData();
    window.graphView.graphLoad(data);
    const n = data.nodes.length;
    const e = data.edges.length;
    graphNodeCount.textContent = `${n} theme${n !== 1 ? 's' : ''}, ${e} connection${e !== 1 ? 's' : ''}`;
  } catch (err) {
    graphNodeCount.textContent = 'Failed to load graph';
    console.error('[graph] loadGraphView error:', err);
  } finally {
    btnGraphRefresh.disabled = false;
  }
}

btnGraphRefresh.addEventListener('click', () => {
  _destroyGraphIfActive();
  loadGraphView();
});

btnGraphReset.addEventListener('click', () => {
  // Re-run the simulation from new random positions
  _destroyGraphIfActive();
  loadGraphView();
});

// ── Cognitive Dashboard view controller ─────────────────────────────────────

const dashNumEntries       = document.getElementById('dash-num-entries');
const dashNumWeek          = document.getElementById('dash-num-week');
const dashNumLoops         = document.getElementById('dash-num-loops');
const dashNumContradictions = document.getElementById('dash-num-contradictions');
const dashDensityChart     = document.getElementById('dash-density-chart');
const dashActiveThemes     = document.getElementById('dash-active-themes');
const dashActiveCount      = document.getElementById('dash-active-count');
const dashEmergingThemes   = document.getElementById('dash-emerging-themes');
const dashEmergingCount    = document.getElementById('dash-emerging-count');
const dashOpenLoops        = document.getElementById('dash-open-loops');
const dashLoopsCount       = document.getElementById('dash-loops-count');
const dashRecentCaptures   = document.getElementById('dash-recent-captures');
const btnDashRefresh       = document.getElementById('btn-dash-refresh');

function _truncate(text, len = 72) {
  if (!text) return '—';
  return text.length > len ? text.slice(0, len) + '…' : text;
}

/** Navigate to a view and then call an action once rendered */
function _dashNavigate(viewId, action) {
  activateView(viewId);
  if (action) setTimeout(action, 160);
}

async function loadDashboardView() {
  try {
    const d = await window.neurologue.getDashboardSummary();

    // Stat cards — deep links
    dashNumEntries.textContent        = d.totalEntries ?? 0;
    dashNumWeek.textContent           = d.weeklyEntryCount ?? 0;
    dashNumLoops.textContent          = d.openLoopCount ?? 0;
    dashNumContradictions.textContent = d.contradictionCount ?? 0;

    document.getElementById('dash-stat-entries').onclick =
      () => _dashNavigate('library');
    document.getElementById('dash-stat-week').onclick =
      () => _dashNavigate('library');
    document.getElementById('dash-stat-contradictions').onclick =
      () => _dashNavigate('contradictions');
    document.getElementById('dash-stat-loops').onclick = () => {
      if (d.openLoopEntries.length > 0) {
        _dashNavigate('library', () => selectEntry(d.openLoopEntries[0].id));
      }
    };

    // Thought density bar chart
    dashDensityChart.innerHTML = '';
    if (d.thoughtDensity && d.thoughtDensity.length > 0) {
      const maxCount = Math.max(...d.thoughtDensity.map((r) => r.count), 1);
      const dayMap = Object.fromEntries(d.thoughtDensity.map((r) => [r.day, r.count]));
      for (let i = 13; i >= 0; i--) {
        const d2 = new Date(Date.now() - i * 86400000);
        const key = d2.toISOString().slice(0, 10);
        const count = dayMap[key] || 0;
        const bar = document.createElement('div');
        bar.className = 'dash-density-bar';
        bar.style.height = `${Math.max(4, Math.round((count / maxCount) * 36))}px`;
        bar.title = `${key}: ${count} note${count !== 1 ? 's' : ''}`;
        dashDensityChart.appendChild(bar);
      }
    }

    // Active themes — navigate to Themes and select
    dashActiveCount.textContent = d.activeThemes.length ? `(${d.activeThemes.length})` : '';
    dashActiveThemes.innerHTML = '';
    if (d.activeThemes.length === 0) {
      dashActiveThemes.innerHTML = '<div class="dash-empty">No recent theme activity</div>';
    } else {
      d.activeThemes.forEach((t) => {
        const el = document.createElement('div');
        el.className = 'dash-theme-chip';
        el.innerHTML = `<span>${t.display_name}</span><span class="dash-theme-entry-count">${t.entry_count} entries</span>`;
        el.addEventListener('click', () =>
          _dashNavigate('themes', () => selectThemeView(t.id))
        );
        dashActiveThemes.appendChild(el);
      });
    }

    // Emerging themes — navigate to Themes and select
    dashEmergingCount.textContent = d.emergingThemes.length ? `(${d.emergingThemes.length})` : '';
    dashEmergingThemes.innerHTML = '';
    if (d.emergingThemes.length === 0) {
      dashEmergingThemes.innerHTML = '<div class="dash-empty">No new themes this week</div>';
    } else {
      d.emergingThemes.forEach((t) => {
        const el = document.createElement('div');
        el.className = 'dash-theme-chip';
        el.innerHTML = `<div class="dash-emerging-dot"></div><span>${t.display_name}</span><span class="dash-theme-entry-count">${t.entry_count} entries</span>`;
        el.addEventListener('click', () =>
          _dashNavigate('themes', () => selectThemeView(t.id))
        );
        dashEmergingThemes.appendChild(el);
      });
    }

    // Open loops — navigate to Library and select the entry
    dashLoopsCount.textContent = d.openLoopCount ? `(${d.openLoopCount})` : '';
    dashOpenLoops.innerHTML = '';
    if (d.openLoopEntries.length === 0) {
      dashOpenLoops.innerHTML = '<div class="dash-empty">No open loops detected</div>';
    } else {
      d.openLoopEntries.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'dash-loop-item';
        el.textContent = _truncate(e.content, 80);
        el.title = e.content;
        el.addEventListener('click', () =>
          _dashNavigate('library', () => selectEntry(e.id))
        );
        dashOpenLoops.appendChild(el);
      });
    }

    // Recent captures — navigate to Library and select the entry
    dashRecentCaptures.innerHTML = '';
    if (d.recentCaptures.length === 0) {
      dashRecentCaptures.innerHTML = '<div class="dash-empty">No notes yet</div>';
    } else {
      d.recentCaptures.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'dash-capture-item';
        el.innerHTML = `<span class="dash-capture-text">${_truncate(e.content, 60)}</span>${e.category ? `<span class="dash-capture-cat">${e.category}</span>` : ''}`;
        el.title = e.content;
        el.addEventListener('click', () =>
          _dashNavigate('library', () => selectEntry(e.id))
        );
        dashRecentCaptures.appendChild(el);
      });
    }
  } catch (err) {
    console.error('[dashboard] loadDashboardView failed:', err);
  }
}

btnDashRefresh.addEventListener('click', loadDashboardView);

// ── Memory Replay view controller ────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

let _replayMonths    = [];  // cached list of active months
let _replayTabActive = 'month';
let _replayLoaded    = false;

function _monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function _monthValue(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Switch between month / compare / abandoned tabs */
function _activateReplayTab(tabId) {
  _replayTabActive = tabId;
  document.querySelectorAll('.replay-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.replay-tab-panel').forEach((p) => {
    p.style.display = p.id === `replay-tab-${tabId}` ? '' : 'none';
  });

  if (tabId === 'abandoned' && !replayAbandonedList.childElementCount) {
    _loadAbandonedIdeas();
  }
}

function _populateMonthSelects() {
  const opts = _replayMonths.map((m) =>
    `<option value="${_monthValue(m.year, m.month)}">${_monthLabel(m.year, m.month)} (${m.count})</option>`
  ).join('');

  replayMonthSelect.innerHTML  = opts || '<option value="">— no entries yet —</option>';

  // Populate all four compare selects
  [replayCompareFrom1, replayCompareTo1, replayCompareFrom2, replayCompareTo2].forEach((sel) => {
    sel.innerHTML = opts || '<option value="">—</option>';
  });

  // Default: compare last two months if available
  if (_replayMonths.length >= 2) {
    replayCompareFrom1.value = _monthValue(_replayMonths[1].year, _replayMonths[1].month);
    replayCompareTo1.value   = _monthValue(_replayMonths[1].year, _replayMonths[1].month);
    replayCompareFrom2.value = _monthValue(_replayMonths[0].year, _replayMonths[0].month);
    replayCompareTo2.value   = _monthValue(_replayMonths[0].year, _replayMonths[0].month);
  }
}

async function _loadMonthSnapshot() {
  const val = replayMonthSelect.value;
  if (!val) return;
  const [year, month] = val.split('-').map(Number);
  replayMonthPh.style.display    = 'none';
  replayMonthContent.style.display = '';
  replayMonthThemes.innerHTML  = '<div class="replay-loading">Loading…</div>';
  replayMonthEntries.innerHTML = '';

  try {
    const snap = await window.neurologue.getMonthSnapshot(year, month);
    replayMonthHeading.textContent = _monthLabel(year, month);
    replayMonthCount.textContent   = `${snap.entryCount} entr${snap.entryCount === 1 ? 'y' : 'ies'}`;

    // Top themes
    replayMonthThemes.innerHTML = '';
    if (snap.topThemes.length === 0) {
      replayMonthThemes.innerHTML = '<div class="replay-empty">No themes were active this month</div>';
    } else {
      snap.topThemes.forEach((t) => {
        const el = document.createElement('div');
        el.className = 'replay-theme-chip';
        el.innerHTML = `<span class="replay-theme-name">${_escHtml(t.display_name)}</span><span class="replay-theme-count">${t.entry_count}</span>`;
        el.title = `View "${t.display_name}" in Themes`;
        el.addEventListener('click', () => {
          activateView('themes');
          selectThemeView(t.id);
        });
        replayMonthThemes.appendChild(el);
      });
    }

    // Entries
    replayMonthEntries.innerHTML = '';
    if (snap.entries.length === 0) {
      replayMonthEntries.innerHTML = '<div class="replay-empty">No entries this month</div>';
    } else {
      snap.entries.forEach((e) => {
        const el = document.createElement('div');
        el.className = 'replay-entry-card';
        const date = new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        el.innerHTML =
          `<div class="replay-entry-meta"><span class="replay-entry-date">${date}</span>${e.category ? `<span class="replay-entry-cat">${_escHtml(e.category)}</span>` : ''}</div>` +
          `<div class="replay-entry-text">${_escHtml(_truncate(e.content, 120))}</div>`;
        el.title = e.content;
        el.addEventListener('click', () => {
          activateView('library');
          selectEntry(e.id);
        });
        replayMonthEntries.appendChild(el);
      });
    }
  } catch (err) {
    console.error('[replay] _loadMonthSnapshot failed:', err);
    replayMonthThemes.innerHTML = '<div class="replay-empty">Error loading snapshot</div>';
  }
}

async function _loadComparePeriods() {
  const from1 = replayCompareFrom1.value;
  const to1   = replayCompareTo1.value;
  const from2 = replayCompareFrom2.value;
  const to2   = replayCompareTo2.value;
  if (!from1 || !to1 || !from2 || !to2) return;

  replayComparePh.style.display    = 'none';
  replayCompareContent.style.display = '';
  replayCompareLost.innerHTML   = '<div class="replay-loading">Loading…</div>';
  replayCompareCommon.innerHTML = '';
  replayCompareGained.innerHTML = '';

  // Periods are month-values (YYYY-MM); build ISO date range [first of month, first of next month)
  function periodRange(val) {
    const [y, m] = val.split('-').map(Number);
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { from, to: next };
  }

  const p1 = periodRange(from1 < to1 ? from1 : to1);
  const p2 = periodRange(from2 > to2 ? from2 : to2);
  // Extend p1 end to end-of-to1 month, p2 start to start-of-from2 month
  const p1From = periodRange(from1 < to1 ? from1 : to1).from;
  const p1To   = periodRange(from1 < to1 ? to1 : from1).to;
  const p2From = periodRange(from2 < to2 ? from2 : to2).from;
  const p2To   = periodRange(from2 < to2 ? to2 : from2).to;

  try {
    const result = await window.neurologue.comparePeriods(p1From, p1To, p2From, p2To);

    function renderThemeList(el, themes) {
      el.innerHTML = '';
      if (themes.length === 0) {
        el.innerHTML = '<div class="replay-empty">—</div>';
        return;
      }
      themes.forEach((t) => {
        const chip = document.createElement('div');
        chip.className = 'replay-theme-chip';
        chip.innerHTML = `<span class="replay-theme-name">${_escHtml(t.display_name)}</span><span class="replay-theme-count">${t.entry_count}</span>`;
        chip.addEventListener('click', () => {
          activateView('themes');
          selectThemeView(t.id);
        });
        el.appendChild(chip);
      });
    }

    renderThemeList(replayCompareLost,   result.lost);
    renderThemeList(replayCompareCommon, result.common);
    renderThemeList(replayCompareGained, result.gained);
  } catch (err) {
    console.error('[replay] _loadComparePeriods failed:', err);
    replayCompareLost.innerHTML = '<div class="replay-empty">Error loading comparison</div>';
  }
}

async function _loadAbandonedIdeas() {
  replayAbandonedList.innerHTML = '<div class="replay-loading">Loading…</div>';
  try {
    const ideas = await window.neurologue.getAbandonedIdeas();
    replayAbandonedList.innerHTML = '';
    if (ideas.length === 0) {
      replayAbandonedList.innerHTML = '<div class="replay-empty" style="margin:16px">No abandoned ideas found — great, you\'re keeping up!</div>';
      return;
    }
    ideas.forEach((e) => {
      const el = document.createElement('div');
      el.className = 'replay-entry-card replay-abandoned-card';
      const date = new Date(e.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      el.innerHTML =
        `<div class="replay-entry-meta"><span class="replay-entry-date">${date}</span>${e.category ? `<span class="replay-entry-cat">${_escHtml(e.category)}</span>` : ''}</div>` +
        `<div class="replay-entry-text">${_escHtml(_truncate(e.content, 140))}</div>`;
      el.title = e.content;
      el.addEventListener('click', () => {
        activateView('library');
        selectEntry(e.id);
      });
      replayAbandonedList.appendChild(el);
    });
  } catch (err) {
    console.error('[replay] _loadAbandonedIdeas failed:', err);
    replayAbandonedList.innerHTML = '<div class="replay-empty">Error loading abandoned ideas</div>';
  }
}

async function loadReplayView() {
  // Load months list once per session (re-load each time view activates for freshness)
  try {
    _replayMonths = await window.neurologue.listActiveMonths();
    _populateMonthSelects();

    // Auto-load most recent month
    if (_replayMonths.length > 0 && replayMonthSelect.value) {
      await _loadMonthSnapshot();
    }
  } catch (err) {
    console.error('[replay] loadReplayView failed:', err);
  }
}

// Tab click handlers
document.querySelectorAll('.replay-tab').forEach((btn) => {
  btn.addEventListener('click', () => _activateReplayTab(btn.dataset.tab));
});

// Month select change
replayMonthSelect.addEventListener('change', _loadMonthSnapshot);

// Compare button
btnReplayCompare.addEventListener('click', _loadComparePeriods);

// ── Agents view controller ─────────────────────────────────────────────────

const agentsGrid          = document.getElementById('agents-grid');
const agentsOutputPanel   = document.getElementById('agents-output-panel');
const agentsOutputLabel   = document.getElementById('agents-output-label');
const agentsRunningInd    = document.getElementById('agents-running-indicator');
const agentsOutputBody    = document.getElementById('agents-output');
const btnAgentsClear      = document.getElementById('btn-agents-clear');
const btnAgentsStop       = document.getElementById('btn-agents-stop');

let _agentsLoaded = false;
let _agentsRunning = false;

function _setAgentsRunning(running) {
  _agentsRunning = running;
  agentsRunningInd.style.display = running ? '' : 'none';
  btnAgentsStop.style.display    = running ? '' : 'none';
  document.querySelectorAll('.agent-card').forEach((c) => {
    c.classList.toggle('running', running && c.classList.contains('running'));
    c.querySelector('.btn-agent-run').disabled = running;
  });
}

async function loadAgentsView() {
  // Always reset indicator state when the view becomes active
  if (!_agentsRunning) {
    agentsRunningInd.style.display = 'none';
    btnAgentsStop.style.display    = 'none';
  }

  if (_agentsLoaded) return;
  _agentsLoaded = true;

  try {
    const agents = await window.neurologue.listAgents();
    agentsGrid.innerHTML = '';
    agents.forEach((a) => {
      const card = document.createElement('div');
      card.className  = 'agent-card';
      card.dataset.id = a.id;
      card.innerHTML =
        `<div class="agent-card-header">` +
        `  <span class="agent-card-icon">${a.icon}</span>` +
        `  <span class="agent-card-label">${_escHtml(a.label)}</span>` +
        `</div>` +
        `<div class="agent-card-desc">${_escHtml(a.description)}</div>` +
        `<div class="agent-card-footer"><button class="btn-agent-run">Run</button></div>`;

      card.querySelector('.btn-agent-run').addEventListener('click', () => _runAgent(a.id, a.label));
      agentsGrid.appendChild(card);
    });
  } catch (err) {
    console.error('[agents] loadAgentsView failed:', err);
    agentsGrid.innerHTML = '<div style="color:var(--text-dim);font-size:13px">Could not load agents</div>';
  }
}

async function _runAgent(agentId, label) {
  if (_agentsRunning) return;

  // Mark the active card and show running state
  document.querySelectorAll('.agent-card').forEach((c) => {
    c.classList.toggle('running', c.dataset.id === agentId);
  });

  agentsOutputPanel.style.display = '';
  agentsOutputLabel.textContent   = label;
  agentsOutputBody.textContent    = '';
  _setAgentsRunning(true);

  agentsOutputPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    await window.neurologue.runAgent(agentId);
  } catch (err) {
    // IPC error (not an abort) — reset state here since agent:done won't fire
    agentsOutputBody.textContent += `\n\n[Error: ${err.message}]`;
    _setAgentsRunning(false);
    document.querySelectorAll('.agent-card.running').forEach((c) => c.classList.remove('running'));
  }
  // Normal completion: state reset by onAgentDone
}

// Stream tokens into the output body
window.neurologue.onAgentToken(({ token }) => {
  agentsOutputBody.textContent += token;
  agentsOutputBody.scrollTop = agentsOutputBody.scrollHeight;
});

// Agent done (via push event — more reliable than awaiting runAgent resolve)
window.neurologue.onAgentDone(() => {
  _setAgentsRunning(false);
  document.querySelectorAll('.agent-card.running').forEach((c) => c.classList.remove('running'));
});

btnAgentsStop.addEventListener('click', async () => {
  // Show stopped message immediately, then abort — agent:done will clean up state
  agentsOutputBody.textContent += '\n\n[Stopped]';
  agentsOutputBody.scrollTop = agentsOutputBody.scrollHeight;
  window.neurologue.abortAgent(); // fire-and-forget; agent:done arrives shortly after
});

btnAgentsClear.addEventListener('click', () => {
  agentsOutputBody.textContent = '';
  agentsOutputPanel.style.display = 'none';
});

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ────────────────────────────────────────────────────────────

(async () => {
  // Apply persisted theme before first paint
  const initSettings = await window.neurologue.getSettings();
  applyTheme(initSettings.theme || 'dark');

  await loadTags();
  await loadCategories();
  await loadEntries();
  runSetupCheck(); // checks Ollama install + models, shows modal if needed
})();
