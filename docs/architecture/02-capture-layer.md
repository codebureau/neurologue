# Capture Layer Architecture

The Capture Layer is the entry point into Neurologue. It must be fast, frictionless, and reliable.

---

## Goals

- Zero‑friction input
- Zero AI involvement
- Minimal UI
- Instant save
- Works offline
- Never blocks or lags

---

## Components

### **1. Global Hotkey**
- Opens the capture popup
- Configurable (default: Ctrl+Shift+Space)
- Must work system‑wide

### **2. Capture Popup**
A small, focused UI with:
- Multiline text box
- Tag input (comma‑separated)
- Paste support (text, images in future)
- Save button
- Auto‑close on save

### **3. Capture Controller**
Responsible for:
- Validating input
- Creating a new entry record
- Creating tag records if needed
- Writing to SQLite

### **4. No AI at Capture Time**
The capture layer must:
- Never call an LLM
- Never generate embeddings
- Never block on background tasks

All processing happens later.

---

## Data Written

When a user saves an entry:

```
entries:
    id
    created_at
    content
    source = "manual" | "clipboard" | "image" (future)
    type = "note" (default)
    metadata = {}
```


Tags are written to:
- `tags`
- `entry_tags`

---

## UX Requirements

- Popup appears instantly
- Cursor auto‑focuses on text box
- Escape closes popup without saving
- Enter + modifier saves
- Smooth animations (optional)

---

## Future Enhancements

- Image capture
- Voice capture
- Browser extension
- Quick‑add tasks
