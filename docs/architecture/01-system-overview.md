# Neurologue — System Overview

Neurologue is a local‑first cognitive system designed to capture, organise, and understand personal thoughts. It is built around four core layers:

1. **Capture Layer**  
   Fast, frictionless input with zero AI involvement.

2. **Library Layer**  
   A multi‑dimensional store of raw entries, tags, embeddings, and AI‑generated structures.

3. **Processing Layer**  
   A background worker that organises thoughts using lightweight local AI models.

4. **Export Layer**  
   A portable representation of all knowledge for use with external AI tools.

Neurologue is intentionally modular. Each layer can evolve independently, and each has a clear responsibility boundary.

---

## High‑Level Architecture Diagram (Conceptual)

```
[ Capture Layer ] → [ Library Layer ] → [ Processing Layer ] → [ Export Layer ]
|                   |                    |                    |
(Electron/Tauri)     (SQLite + Vector DB)   (Worker + LLMs)     (JSON/MD/Embeddings)
```


---

## Core Principles

### **Local‑First**
All data, embeddings, and models run on the user’s machine.

### **Privacy‑Preserving**
No cloud calls. No telemetry. No external dependencies.

### **Lightweight AI**
Small models (Phi‑3 Mini, Qwen 2.5 3B) for summarisation and clustering.

### **Separation of Concerns**
Capture is fast.  
Processing is asynchronous.  
Library is structured.  
Export is portable.

---

## Component Responsibilities

### **Capture Layer**
- Global hotkey
- Popup UI
- Text + clipboard input
- Optional tags
- Writes raw entries to SQLite

### **Library Layer**
- Stores entries, tags, embeddings, themes
- Entry categorisation (auto-assigned + user override)
- Timeline with infinite scroll, day/week/month grouping, and activity heatmap
- Filtering by tag, category, and free text (combined AND semantics)
- Tag management: rename, delete, merge, duplicate detection (structural + semantic)
- LLM tag suggestions in entry detail panel and capture popup
- Semantic search and full-text search
- Acts as the system’s source of truth

### **Processing Layer**
- Embedding generation (nomic-embed-text via Ollama)
- Clustering (k-means, local)
- Theme creation and LLM summaries (phi3:mini)
- Entry categorisation: Task / Thought / Reminder / Idea / Question / Decision
- LLM tag suggestions
- Contradiction detection
- Open loop detection

### **Export Layer**
- JSON export
- Markdown export
- Embeddings export
- Designed for external AI consumption

---

## Data Flow Summary

1. **User captures a thought**  
   → stored as a raw entry

2. **Background worker processes new entries**  
   → embeddings, themes, summaries

3. **Library UI displays structured knowledge**  
   → timeline, themes, semantic search

4. **User exports corpus**  
   → external AI tools can reason over it

---

## Future Extensions

- Image capture + OCR  
- Voice capture + transcription  
- Knowledge graph visualisation  
- Plugin system  
- Personal agent reasoning  
