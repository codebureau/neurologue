'use strict';

// capture.js — renderer process script for the capture popup.
// Runs in contextIsolation; communicates with main via window.capture (exposed by capture-preload.js).

const contentEl    = document.getElementById('content');
const tagsEl       = document.getElementById('tags');
const tagSuggestions = document.getElementById('tag-suggestions');
const saveBtn      = document.getElementById('btn-save');
const errorMsg     = document.getElementById('error-msg');
const toolbar      = document.getElementById('toolbar');
const mdToggle     = document.getElementById('md-toggle');
const previewEl    = document.getElementById('preview');
const tbPreview    = document.getElementById('tb-preview');
const btnPastePlain = document.getElementById('btn-paste-plain');

// ── State ─────────────────────────────────────────────────────────────────

let _mdMode       = false;
let _previewMode  = false;
let _pastePlain   = false;
let _suggestTimer = null;

// ── Tag suggestions ───────────────────────────────────────────────────────

function _currentTagSet() {
  return new Set(
    tagsEl.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  );
}

function _renderSuggestions(tags) {
  tagSuggestions.innerHTML = '';
  const current = _currentTagSet();
  const fresh = tags.filter((t) => !current.has(t));
  if (!fresh.length) { tagSuggestions.classList.remove('visible'); return; }

  const label = document.createElement('span');
  label.className = 'tag-suggestions-label';
  label.textContent = 'Suggestions:';
  tagSuggestions.appendChild(label);

  fresh.forEach((tag) => {
    const pill = document.createElement('button');
    pill.className = 'tag-suggestion';
    pill.type = 'button';
    pill.textContent = `#${tag}`;
    pill.addEventListener('click', () => {
      const existing = tagsEl.value.trim();
      tagsEl.value = existing ? `${existing}, ${tag}` : tag;
      // Remove from suggestions
      pill.remove();
      if (tagSuggestions.querySelectorAll('.tag-suggestion').length === 0) {
        tagSuggestions.classList.remove('visible');
      }
    });
    tagSuggestions.appendChild(pill);
  });
  tagSuggestions.classList.add('visible');
}

async function _fetchSuggestions() {
  const text = contentEl.value.trim();
  if (text.length < 20) return; // too short to bother
  try {
    const result = await window.capture.suggestTags(text);
    if (result.ok && result.suggestions.length > 0) {
      _renderSuggestions(result.suggestions);
    }
  } catch {
    // suggestions are best-effort — silently ignore errors
  }
}

// ── Enable/disable Save based on content ──────────────────────────────────

contentEl.addEventListener('input', () => {
  saveBtn.disabled = contentEl.value.trim().length === 0;
  hideError();
  if (_previewMode) renderPreview();
  // Debounce tag suggestions — fire 900ms after user stops typing
  clearTimeout(_suggestTimer);
  _suggestTimer = setTimeout(_fetchSuggestions, 900);
});

// ── Markdown toggle ───────────────────────────────────────────────────────

mdToggle.addEventListener('change', () => {
  _mdMode = mdToggle.checked;
  toolbar.classList.toggle('visible', _mdMode);
  contentEl.classList.toggle('plain-font', !_mdMode);
  if (!_mdMode) {
    // leaving MD mode: exit preview
    setPreviewMode(false);
  }
});

// ── Preview toggle ────────────────────────────────────────────────────────

tbPreview.addEventListener('click', () => setPreviewMode(!_previewMode));

function setPreviewMode(on) {
  _previewMode = on;
  tbPreview.classList.toggle('active', on);
  if (on) {
    renderPreview();
    contentEl.style.display = 'none';
    previewEl.classList.add('visible');
  } else {
    contentEl.style.display = '';
    previewEl.classList.remove('visible');
    contentEl.focus();
  }
}

function renderPreview() {
  previewEl.innerHTML = parseMarkdown(contentEl.value);
}

// ── Lightweight Markdown → HTML parser ───────────────────────────────────
// Handles: headings, bold, italic, inline code, fenced code blocks,
// blockquotes, unordered lists, ordered lists, links, horizontal rules.

function parseMarkdown(md) {
  const lines = md.split('\n');
  const out   = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(escHtml(lines[i]));
        i++;
      }
      out.push(`<pre><code>${code.join('\n')}</code></pre>`);
      i++;
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.*)/);
    if (hm) { out.push(`<h${hm[1].length}>${inlineHtml(hm[2])}</h${hm[1].length}>`); i++; continue; }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const bq = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bq.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inlineHtml(bq.join(' '))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        items.push(`<li>${inlineHtml(lines[i].replace(/^[-*+]\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(`<li>${inlineHtml(lines[i].replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // Blank line
    if (line.trim() === '') { i++; continue; }

    // Paragraph
    out.push(`<p>${inlineHtml(line)}</p>`);
    i++;
  }

  return out.join('');
}

function inlineHtml(text) {
  return escHtml(text)
    // bold+italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // link [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Formatting toolbar buttons ────────────────────────────────────────────

function wrapSelection(before, after, placeholder) {
  if (_previewMode) return;
  const start = contentEl.selectionStart;
  const end   = contentEl.selectionEnd;
  const sel   = contentEl.value.slice(start, end) || placeholder;
  const replacement = before + sel + after;
  contentEl.setRangeText(replacement, start, end, 'select');
  contentEl.focus();
  saveBtn.disabled = contentEl.value.trim().length === 0;
}

function prependLines(prefix) {
  if (_previewMode) return;
  const start = contentEl.selectionStart;
  const end   = contentEl.selectionEnd;
  const text  = contentEl.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEnd   = text.indexOf('\n', end);
  const block     = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const prefixed  = block.split('\n').map(l => prefix + l).join('\n');
  contentEl.setRangeText(prefixed, lineStart, lineEnd === -1 ? text.length : lineEnd, 'select');
  contentEl.focus();
  saveBtn.disabled = contentEl.value.trim().length === 0;
}

document.getElementById('tb-bold')  .addEventListener('click', () => wrapSelection('**', '**', 'bold text'));
document.getElementById('tb-italic').addEventListener('click', () => wrapSelection('*',  '*',  'italic text'));
document.getElementById('tb-code')  .addEventListener('click', () => wrapSelection('`',  '`',  'code'));
document.getElementById('tb-ul')    .addEventListener('click', () => prependLines('- '));
document.getElementById('tb-quote') .addEventListener('click', () => prependLines('> '));
document.getElementById('tb-link')  .addEventListener('click', () => wrapSelection('[', '](https://)', 'link text'));

// ── Keyboard shortcuts ────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.capture.close();
    return;
  }

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!saveBtn.disabled) save();
    return;
  }

  // Markdown shortcuts (only when MD mode active and not in preview)
  if (_mdMode && !_previewMode) {
    if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapSelection('**', '**', 'bold text'); }
    if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapSelection('*',  '*',  'italic text'); }
  }
});

// ── Paste-plain-text toggle (#37) ─────────────────────────────────────────

btnPastePlain.addEventListener('click', () => {
  _pastePlain = !_pastePlain;
  btnPastePlain.classList.toggle('active', _pastePlain);
  btnPastePlain.title = _pastePlain
    ? 'Paste plain text: ON — click to disable'
    : 'Paste without formatting';
});

contentEl.addEventListener('paste', (e) => {
  if (!_pastePlain) return;
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  const start = contentEl.selectionStart;
  const end   = contentEl.selectionEnd;
  contentEl.setRangeText(text, start, end, 'end');
  saveBtn.disabled = contentEl.value.trim().length === 0;
  hideError();
});

tagsEl.addEventListener('paste', (e) => {
  if (!_pastePlain) return;
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  const start = tagsEl.selectionStart;
  const end   = tagsEl.selectionEnd;
  tagsEl.setRangeText(text, start, end, 'end');
});

// ── Save button ───────────────────────────────────────────────────────────

saveBtn.addEventListener('click', save);

async function save() {
  const content = contentEl.value.trim();
  if (!content) return;

  const tags = tagsEl.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  saveBtn.disabled = true;

  try {
    const result = await window.capture.save({ content, tags });
    if (result.ok) {
      window.capture.close();
    } else {
      showError('Failed to save. Please try again.');
      saveBtn.disabled = false;
    }
  } catch (err) {
    showError('An unexpected error occurred.');
    saveBtn.disabled = false;
    console.error('[capture] save error:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('visible');
}

function hideError() {
  errorMsg.classList.remove('visible');
}

contentEl.focus();
