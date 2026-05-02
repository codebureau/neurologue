# Neurologue Roadmap

Neurologue is a local‑first cognitive system built around four layers:
1. Capture  
2. Library  
3. Processing  
4. Export  

This roadmap outlines the staged development plan from prototype to v1.  
Each milestone is intentionally small, buildable, and testable.

---

# Phase 0 — Foundations (Design & Scaffolding)

**Goal:** Establish structure, constraints, and development workflow.

### Tasks
- [x] Create repository structure
- [x] Add README
- [x] Add architecture documents
- [x] Add requirements documents
- [x] Add Copilot bootstrap prompt
- [ ] Choose Electron vs Tauri for frontend
- [ ] Choose Node vs Python for backend worker
- [ ] Finalise embedding + LLM model selection

**Output:** A fully scaffolded repo ready for implementation.

---

# Phase 1 — Core Data Layer (SQLite + Embeddings)

**Goal:** Implement the storage foundation Neurologue relies on.

### Tasks
- [ ] Implement SQLite schema (`entries`, `tags`, `entry_tags`, `embeddings`, `themes`, `theme_entries`)
- [ ] Add DB migration system
- [ ] Add DB access layer (CRUD operations)
- [ ] Add local vector DB integration (Chroma or LanceDB)
- [ ] Add configuration file for model paths and settings

**Output:** A working local datastore with structured + vector storage.

---

# Phase 2 — Capture Layer (Fast Input)

**Goal:** Build the frictionless capture experience.

### Tasks
- [ ] Implement global hotkey
- [ ] Build capture popup UI
- [ ] Add text input
- [ ] Add tag input
- [ ] Add clipboard paste support
- [ ] Save entries to SQLite
- [ ] Add minimal UX polish (animations, auto-close, etc.)

**Output:** A fast, reliable way to capture thoughts instantly.

---

# Phase 3 — Library Layer (Views & Retrieval)

**Goal:** Provide a usable interface for browsing and searching entries.

### Tasks
- [ ] Build timeline view (chronological entries)
- [ ] Build tag view (manual tags)
- [ ] Build entry detail view
- [ ] Add full‑text search
- [ ] Add semantic search (query → embedding → similarity)
- [ ] Add related entries panel (nearest neighbours)

**Output:** A functional personal library with semantic recall.

---

# Phase 4 — Processing Layer (Background AI)

**Goal:** Add intelligence that organises thoughts automatically.

### Tasks
- [ ] Implement background worker
- [ ] Generate embeddings for new entries
- [ ] Implement clustering (k‑means or hierarchical)
- [ ] Create themes from clusters
- [ ] Generate theme summaries using small LLM
- [ ] Suggest tags based on content
- [ ] Detect contradictions within themes
- [ ] Identify “open loops” (tasks, unresolved items)

**Output:** Automated organisation and insight generation.

---

# Phase 5 — Export Layer (Portability)

**Goal:** Make Neurologue’s knowledge usable by external AI tools.

### Tasks
- [ ] Export raw entries (JSON / Markdown)
- [ ] Export themes + summaries
- [ ] Export embeddings (JSONL or vector DB folder)
- [ ] Add “Export All” UI
- [ ] Add scheduled auto‑export (optional)

**Output:** A portable personal knowledge corpus.

---

# Phase 6 — UX & Quality