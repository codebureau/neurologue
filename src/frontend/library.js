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
const statusOllama  = document.getElementById('status-ollama');
const statusWorker  = document.getElementById('status-worker');

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

// ── Export ─────────────────────────────────────────────────────────────────

let _exportToastTimer = null;

function showToast(message, type = 'success') {
  exportToast.textContent = message;
  exportToast.className = type;
  exportToast.style.display = 'block';
  clearTimeout(_exportToastTimer);
  _exportToastTimer = setTimeout(() => { exportToast.style.display = 'none'; }, 5000);
}

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting…';
  try {
    const result = await window.neurologue.exportAll({ includeEmbeddings: true });
    if (result.canceled) {
      showToast('Export cancelled.', 'success');
    } else {
      showToast(
        `Exported ${result.entryCount} entries, ${result.themeCount} themes to ${result.destDir}`,
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

// ── Status bar ──────────────────────────────────────────────────────

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
  }
}

window.neurologue.onWorkerStatus(updateStatus);
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

  await window.neurologue.saveSettings({ embeddingModel: embedModel, llmModel, tagSuggestionFormat: tagFmt, tagSimilarityThreshold });
  const msg = document.getElementById('settings-saved-msg');
  msg.classList.remove('hidden');
  setTimeout(() => msg.classList.add('hidden'), 2000);
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

  if (viewId === 'themes') loadThemesView();
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

let _themesActiveId = null;

async function loadThemesView() {
  try {
    const themes = await window.neurologue.listThemes();
    themesListEl.innerHTML = '';
    themesListCountEl.textContent = themes.length ? `${themes.length} themes` : '';

    if (themes.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 14px;font-size:13px;color:var(--text-dim)';
      empty.textContent = 'No themes yet — clustering runs automatically as you add entries.';
      themesListEl.appendChild(empty);
      return;
    }

    themes.forEach((theme) => {
      const item = document.createElement('div');
      item.className = 'themes-list-item' + (theme.id === _themesActiveId ? ' active' : '');
      item.dataset.id = theme.id;
      const entryWord = theme.entry_count === 1 ? '1 entry' : `${theme.entry_count} entries`;
      item.innerHTML =
        `<div class="tli-name">${escHtml(theme.display_name || theme.name)}</div>` +
        `<div class="tli-meta">${entryWord}</div>`;
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

// ── Init ────────────────────────────────────────────────────────────

(async () => {
  await loadTags();
  await loadCategories();
  await loadEntries();
  runSetupCheck(); // checks Ollama install + models, shows modal if needed
})();
