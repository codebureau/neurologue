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
  tagFilter: null,   // tag name string or null
  selectedId: null,
  activeThemeId: null,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const btnText       = document.getElementById('btn-text');
const btnSemantic   = document.getElementById('btn-semantic');
const entryCount    = document.getElementById('entry-count');
const timelineList  = document.getElementById('timeline-list');
const loadMoreBtn   = document.getElementById('load-more-btn');
const tagList       = document.getElementById('tag-list');
const tagAll        = document.getElementById('tag-all');
const themeList     = document.getElementById('theme-list');
const detailPlaceholder      = document.getElementById('detail-placeholder');
const detailContent          = document.getElementById('detail-content');
const themeDetailContent     = document.getElementById('theme-detail-content');
const detailDate    = document.getElementById('detail-date');
const detailSource  = document.getElementById('detail-source');
const detailText    = document.getElementById('detail-text');
const detailTags    = document.getElementById('detail-tags');
const exportBtn     = document.getElementById('btn-export');
const exportToast   = document.getElementById('export-toast');
const helpBtn       = document.getElementById('btn-help');
const semanticNotice = document.getElementById('semantic-notice');

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

  if (entry.tags && entry.tags.length > 0) {
    const tagRow = document.createElement('div');
    tagRow.className = 'entry-tags';
    entry.tags.slice(0, 6).forEach((t) => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = t.name || t;
      tagRow.appendChild(pill);
    });
    card.appendChild(tagRow);
  }

  card.addEventListener('click', () => selectEntry(entry.id));
  return card;
}

function renderTimeline(entries, append = false) {
  if (!append) timelineList.innerHTML = '';

  if (entries.length === 0 && !append) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = _state.query
      ? `<strong>No results</strong>Try a different search term`
      : `<strong>No entries yet</strong>Press Ctrl+Shift+Space to capture your first thought`;
    timelineList.appendChild(empty);
  } else {
    entries.forEach((e) => timelineList.appendChild(renderEntryCard(e)));
  }
}

function updateCount(total) {
  entryCount.textContent = total === 1 ? '1 entry' : `${total} entries`;
}

// ── Data loading ───────────────────────────────────────────────────────────

async function loadEntries(append = false) {
  const offset = append ? _state.offset : 0;
  let entries = [];

  try {
    if (_state.mode === 'semantic' && _state.query.trim()) {
      const result = await window.neurologue.searchSemantic(_state.query);
      if (!result.ok) {
        semanticNotice.style.display = 'block';
        // Fall back to text search
        entries = await window.neurologue.searchText(_state.query, { limit: PAGE_SIZE, offset });
      } else {
        semanticNotice.style.display = 'none';
        entries = result.results;
      }
      _state.hasMore = false;
      loadMoreBtn.style.display = 'none';
    } else if (_state.query.trim()) {
      entries = await window.neurologue.searchText(_state.query, { limit: PAGE_SIZE, offset });
      _state.hasMore = entries.length === PAGE_SIZE;
    } else {
      entries = await window.neurologue.list({ limit: PAGE_SIZE, offset, tag: _state.tagFilter });
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

function applyTagFilter(tagName) {
  _state.tagFilter = tagName;
  _state.selectedId = null;
  // Update sidebar active state
  document.querySelectorAll('.tag-item').forEach((el) => {
    el.classList.toggle('active', el.querySelector('.tag-name').textContent === tagName);
  });
  loadEntries();
  clearDetail();
}

// ── Entry detail ───────────────────────────────────────────────────────────

async function selectEntry(id) {
  _state.selectedId = id;

  // Update card selection highlight
  document.querySelectorAll('.entry-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  try {
    const entry = await window.neurologue.getEntry(id);
    if (!entry) return;

    detailDate.textContent = formatDate(entry.created_at);
    detailSource.textContent = `Source: ${entry.source || 'manual'}  ·  Type: ${entry.type || 'note'}`;
    detailText.textContent = entry.content;

    detailTags.innerHTML = '';
    if (entry.tags && entry.tags.length > 0) {
      entry.tags.forEach((t) => {
        const pill = document.createElement('span');
        pill.className = 'tag-pill';
        pill.style.cursor = 'pointer';
        pill.textContent = t.name;
        pill.addEventListener('click', () => applyTagFilter(t.name));
        detailTags.appendChild(pill);
      });
      document.getElementById('detail-tags-section').style.display = 'block';
    } else {
      document.getElementById('detail-tags-section').style.display = 'none';
    }

    detailPlaceholder.style.display = 'none';
    detailContent.style.display = 'flex';
  } catch (err) {
    console.error('[library] selectEntry failed:', err);
  }
}

function clearDetail() {
  _state.selectedId = null;
  _state.activeThemeId = null;
  detailPlaceholder.style.display = 'flex';
  detailContent.style.display = 'none';
  themeDetailContent.style.display = 'none';
}

// ── Theme sidebar + detail ─────────────────────────────────────────────────

async function loadThemes() {
  try {
    const themes = await window.neurologue.listThemes();
    themeList.innerHTML = '';
    if (themes.length === 0) return;
    themes.forEach((theme) => {
      const item = document.createElement('div');
      item.className = 'theme-item' + (theme.id === _state.activeThemeId ? ' active' : '');
      item.dataset.id = theme.id;
      item.innerHTML =
        `<span class="theme-icon">◆</span>` +
        `<span class="theme-name">${theme.name}</span>`;
      item.addEventListener('click', () => selectTheme(theme.id));
      themeList.appendChild(item);
    });
  } catch (err) {
    console.error('[library] loadThemes failed:', err);
  }
}

async function selectTheme(id) {
  _state.activeThemeId = id;
  _state.selectedId = null;
  document.querySelectorAll('.theme-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  document.querySelectorAll('.tag-item').forEach((el) => el.classList.remove('active'));

  try {
    const theme = await window.neurologue.getTheme(id);
    if (!theme) return;

    document.getElementById('theme-detail-name').textContent = theme.name;
    document.getElementById('theme-detail-summary').textContent =
      theme.description || 'No summary yet — clustering will generate one when Ollama is available.';

    const entriesEl = document.getElementById('theme-detail-entries');
    entriesEl.innerHTML = '';
    (theme.entries || []).forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'theme-entry-card';
      card.innerHTML =
        `<div class="te-meta">` +
        `<span class="te-date">${formatDate(entry.created_at)}</span>` +
        `<span class="te-score">${entry.score !== undefined ? entry.score.toFixed(2) : ''}</span>` +
        `</div>` +
        `<div class="te-preview">${entry.content}</div>`;
      card.addEventListener('click', () => {
        // Jump to entry detail
        _state.activeThemeId = null;
        document.querySelectorAll('.theme-item').forEach((el) => el.classList.remove('active'));
        selectEntry(entry.id);
      });
      entriesEl.appendChild(card);
    });

    detailPlaceholder.style.display = 'none';
    detailContent.style.display = 'none';
    themeDetailContent.style.display = 'flex';
  } catch (err) {
    console.error('[library] selectTheme failed:', err);
  }
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
  _state.tagFilter = null;
  document.querySelectorAll('.tag-item').forEach((el) => el.classList.remove('active'));
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

// ── Init ───────────────────────────────────────────────────────────────────

(async () => {
  await loadTags();
  await loadThemes();
  await loadEntries();
})();
