# Neurologue  
*A local‑first cognitive system for capturing, organising, and understanding your own thoughts.*

Neurologue is a **personal cognitive layer** designed to help you capture ideas quickly, store them safely, and transform them into structured knowledge using lightweight local AI models. It is not a note‑taking app — it is a **thinking system** built around four core layers:

1. **Capture Layer** — fast, frictionless input  
2. **Library Layer** — multi‑dimensional storage and retrieval  
3. **Processing Layer** — background AI that organises your thoughts  
4. **Export Layer** — portable data for use with other AI tools  

Neurologue runs **entirely locally**, uses **small LLMs**, and stores all data in **SQLite + local embeddings**. No cloud, no accounts, no external dependencies.

---

## Why Neurologue exists

Modern AI tools are powerful, but your personal thinking is fragmented across:

- sticky notes  
- Teams chats  
- OneNote  
- Copilot chats  
- Notepad  
- emails  
- your own head  

Neurologue provides a **single, local, private place** to capture your thoughts and let an AI help you:

- find patterns  
- surface themes  
- detect contradictions  
- recall ideas  
- track open loops  
- build a personal knowledge graph  

All without sending your data anywhere.

---

# Core Architecture

Neurologue is built around four layers:

---

## 1. Capture Layer (fast, zero‑AI)

A global hotkey opens a small popup window for:

- typing text  
- pasting clipboard content  
- adding optional tags  

Entries are saved instantly with timestamps.  
No AI runs during capture — speed is the priority.

---

## 2. Library Layer (your personal cognitive store)

Neurologue stores:

- raw entries (immutable, timestamped)  
- tags  
- embeddings  
- AI‑generated structures (themes, summaries, contradictions)  

The library supports:

- timeline view  
- tag view  
- theme view  
- semantic search  
- full‑text search  
- related‑entry navigation  

---

## 3. Processing Layer (background AI)

A background worker periodically:

- generates embeddings for new entries  
- clusters entries into themes  
- generates theme summaries  
- suggests tags  
- detects contradictions  
- identifies “open loops”  
- maintains metadata for activity and recency  

This layer uses **small local models** (Phi‑3 Mini, Qwen 2.5 3B) via Ollama.

---

## 4. Export Layer (portable knowledge)

Neurologue can export:

- all entries (JSON / Markdown)  
- themes + summaries  
- embeddings (JSONL or vector DB folder)  

This allows external tools (NotebookLM, Claude, Copilot) to reason over your personal corpus.

---

# Local‑First Principles

Neurologue is designed to be:

- **Local** — all data stored on your machine  
- **Private** — no cloud calls  
- **Lightweight** — small models, fast processing  
- **Modular** — capture, library, processing, export are separate  
- **Future‑proof** — everything exportable  

---

# Tech Stack

### Frontend
- **Electron** — global hotkey, capture popup, library UI

### Backend
- **Node.js** — DB access layer, IPC, background worker
- **sql.js** — pure-WASM SQLite (no native compilation required)
- **LanceDB** — embedded local vector store

### AI
- Embeddings: `bge-small-en` or `gte-small` via **Ollama**
- LLM: **Phi‑3 Mini** or **Qwen 2.5 3B** via Ollama
- Background worker for asynchronous processing

---

# Repository Structure
```
/docs
    /architecture/          — layer-by-layer design documents
    /requirements/          — functional, non-functional, data model, LLM
    /copilot/               — Copilot agent guidelines and bootstrap prompt
    /brand/                 — colours, typography, logo guidelines
/src
    main.js                 — Electron entry point
    config.js               — paths, Ollama endpoint, model names
    /capture/
        hotkey.js           — global hotkey + capture BrowserWindow
    /frontend/
        index.html          — main library window (placeholder)
        preload.js          — main window contextBridge
        capture.html        — capture popup UI
        capture.js          — capture popup renderer logic
        capture-preload.js  — capture popup contextBridge
    /backend/
        /db/
            connection.js   — sql.js wrapper (better-sqlite3-compatible API)
            entries.js      — entries CRUD
            tags.js         — tags CRUD
            themes.js       — themes CRUD
            embeddings.js   — embeddings CRUD
        /vector/
            store.js        — LanceDB vector store (init, upsert, search)
    /db/
        migrate.js          — versioned migration runner
        /migrations/
            001_initial_schema.sql
    /worker/                — background processing worker (Phase 4)
```


---

# Development Workflow

Neurologue is built with **Copilot‑assisted development** in mind.

### 1. Requirements live in `/docs/requirements`  
Copilot Agents read these to understand constraints.

### 2. Architecture lives in `/docs/architecture`  
Defines how components interact.

### 3. Copilot Bootstrap Prompt lives in `/docs/copilot`  
This tells Copilot how to behave when generating code.

### 4. Issues drive implementation  
Each feature is implemented through a GitHub Issue with clear acceptance criteria.

---

# Getting Started (Development)

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18 LTS or later | [nodejs.org](https://nodejs.org) |
| npm | bundled with Node | — |
| Ollama | latest | [ollama.com](https://ollama.com) — required for Phase 3+ only |

> **No C++ build toolchain required.** Neurologue uses `sql.js` (pure WASM) and LanceDB (prebuilt binaries).

## Install

```bash
git clone https://github.com/codebureau/neurologue.git
cd neurologue
npm install
```

## Run the app

```bash
npm start
```

This launches the Electron shell. On first run, the SQLite database and LanceDB vector store are created automatically in your OS user-data directory.

- **Windows:** `%APPDATA%\neurologue\`
- **macOS:** `~/Library/Application Support/neurologue/`

## Using the capture hotkey

Once the app is running, press **`Ctrl+Shift+Space`** (Windows/Linux) or **`Cmd+Shift+Space`** (macOS) from anywhere on your desktop to open the capture popup.

- Type your thought
- Optionally add comma-separated tags
- Press **`Ctrl+Enter`** or click **Save**
- Press **`Escape`** to cancel

## Setting up Ollama (Phase 3+)

Ollama is only needed once the background worker is implemented (Phase 3). To prepare:

```bash
# Install Ollama, then pull the required models
ollama pull phi3:mini
ollama pull bge-small-en   # for embeddings (via ollama or direct)
```

Ollama should be running on `http://127.0.0.1:11434` (default). The endpoint is configurable in `src/config.js`.

---

# Project Status

| Phase | Description | Status |
|---|---|---|
| 0 | Foundations (design, scaffolding) | ✅ Complete |
| 1 | Core Data Layer (SQLite, LanceDB, CRUD) | ✅ Complete |
| 2 | Capture Layer (hotkey popup) | ✅ Complete |
| 3 | Background Worker (embeddings via Ollama) | ✅ Complete |
| 4 | Library Layer (timeline, search, themes UI) | ✅ Complete |
| 5 | Processing Layer (clustering, summaries) | ✅ Complete |
| 6 | Export Layer (JSON/MD/embeddings) | ✅ Complete |

See [ROADMAP.md](ROADMAP.md) and [GitHub Issues](https://github.com/codebureau/neurologue/issues) for detail.

---

# Validating the build

## Phase 1 — Data layer

Verify the database is created and all tables exist:

```bash
npm start
# Then close the app and inspect the DB, or run:
node -e "
const { openDb } = require('./src/backend/db/connection');
openDb().then(db => {
  const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
  console.log(t.map(r => r.name));
  process.exit(0);
});
"
```

Expected output: `entries, tags, entry_tags, embeddings, themes, theme_entries, schema_migrations`

## Phase 2 — Capture popup

1. Run `npm start`
2. Press **`Ctrl+Shift+Space`** — the capture popup should appear within 100ms
3. Type a thought, add optional tags, press `Ctrl+Enter`
4. The popup closes — the entry is saved to SQLite
5. Press `Escape` to close without saving

To confirm an entry was written:

```bash
node -e "
const { listEntries } = require('./src/backend/db/entries');
listEntries().then(rows => { console.log(rows); process.exit(0); });
"
```

## Phase 3 — Background worker

The worker starts automatically when the app runs. It polls every 10 seconds for entries without embeddings and calls Ollama to generate them.

**Prerequisites:** Ollama must be running with the embedding model pulled:

```bash
ollama serve              # if not already running as a service
ollama pull bge-small-en  # or the model set in src/config.js
```

**To validate:**

1. Start Ollama and pull the model (above)
2. Run `npm start`
3. Capture one or more entries via `Ctrl+Shift+Space`
4. Wait up to 10 seconds — the worker will pick up new entries
5. Check the console output for `[worker] Embedded entry …` messages
6. Confirm embeddings were stored:

```bash
node -e "
const { openDb } = require('./src/backend/db/connection');
openDb().then(db => {
  const rows = db.prepare('SELECT entry_id, model_name FROM embeddings').all();
  console.log(rows);
  process.exit(0);
});
"
```

**If Ollama is not running:** the worker logs `[worker] Ollama not available — skipping tick` and retries on the next interval. The app continues to function normally.

## Phase 4 — Library Layer

The library window opens automatically at startup and shows a 3-column layout: tag sidebar | entry timeline | entry detail.

**To validate:**

1. Run `npm start`
2. The library window opens — your captured entries appear in the timeline (newest first)
3. **Text search:** type in the search bar, results filter in real-time (300ms debounce)
4. **Semantic search:** click **Semantic** mode button, type a query — if Ollama is running it returns nearest-neighbour results; otherwise a notice banner appears and text results are shown as fallback
5. **Tag filter:** click a tag in the left sidebar — the timeline shows only entries with that tag
6. **Entry detail:** click any entry card — the right panel shows full text, date, source, and tags
7. **Tag navigation:** clicking a tag pill in the detail panel applies that tag as a filter

**To confirm tag indexing:**

```bash
node -e "
const { listTags } = require('./src/backend/db/tags');
listTags().then(tags => { console.log(tags); process.exit(0); });
"
```

## Phase 5 — Theme Clustering + Summaries

The background worker now automatically clusters entries into themes after every 5 new embeddings. Themes appear in the **Themes** section of the library sidebar.

**Prerequisites:** Ollama running with both models:

```bash
ollama pull bge-small-en   # embeddings
ollama pull phi3:mini      # LLM summaries
```

**To validate:**

1. Capture at least 5 entries with `Ctrl+Shift+Space`
2. Ensure Ollama is running so the worker can embed them
3. After 5 embeddings the worker logs `[worker] Clustering complete — N themes`
4. The **Themes** section in the sidebar lists the discovered themes
5. Click a theme — the right panel shows its LLM-generated summary and member entries
6. Clicking an entry in the theme panel opens its full detail view

**If Ollama is not running:** themes still form (k-means runs locally) but the description will read “No summary yet” until Ollama becomes available.

**To manually trigger clustering from the DevTools console:**

```js
await window.neurologue.triggerClustering()
```

## Phase 6 — Export Layer

The **Export…** button in the top-right of the toolbar opens a native folder picker. Neurologue writes five files to the chosen directory:

| File | Contents |
|---|---|
| `entries.json` | All entries as a JSON array (id, content, source, type, created_at, tags) |
| `entries.md` | All entries as a single Markdown document |
| `themes.json` | Themes + LLM summaries + member entry IDs and scores |
| `themes.md` | Themes as a Markdown document |
| `embeddings.jsonl` | All embeddings (entry_id, model_name, vector array) |

**To validate:**

1. Run `npm start`
2. Capture some entries and wait for embeddings + themes
3. Click **Export…** in the toolbar
4. Choose a destination folder in the native dialog
5. A toast notification confirms the export with entry/theme counts
6. Open the folder — all five files should be present

The resulting files are suitable for ingestion into external tools (NotebookLM, Claude, Copilot, etc.).

---

# License

TBD.
