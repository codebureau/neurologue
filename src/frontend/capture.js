'use strict';

// capture.js — renderer process script for the capture popup.
// Runs in contextIsolation; communicates with main via window.capture (exposed by capture-preload.js).

const contentEl = document.getElementById('content');
const tagsEl    = document.getElementById('tags');
const saveBtn   = document.getElementById('btn-save');
const errorMsg  = document.getElementById('error-msg');

// ── Enable/disable Save based on content ──────────────────────────────────

contentEl.addEventListener('input', () => {
  saveBtn.disabled = contentEl.value.trim().length === 0;
  hideError();
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Escape → close without saving
  if (e.key === 'Escape') {
    window.capture.close();
    return;
  }

  // Ctrl+Enter → save
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!saveBtn.disabled) save();
  }
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

// Auto-focus the text area when the window opens
contentEl.focus();
