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
- Electron or Tauri  
- Global hotkey  
- Capture popup  
- Library UI  

### Backend
- Node.js (or Python)  
- SQLite for structured data  
- Local vector DB (Chroma or LanceDB)  

### AI
- Embeddings: `bge-small-en`, `gte-small`, or similar  
- LLM: Phi‑3 Mini or Qwen 2.5 3B via Ollama  
- Background worker for processing  

---

# Repository Structure
```
/docs
    /architecture
        01-system-overview.md
        02-capture-layer.md
        03-library-layer.md
        04-processing-layer.md
        05-export-layer.md
    /requirements
        functional-requirements.md
        nonfunctional-requirements.md
        data-model.md
        llm-requirements.md
/copilot
    copilot-bootstrap.md
    agent-guidelines.md
/src
    /frontend
    /backend
    /worker
    /db
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

1. Clone the repo  
2. Install dependencies (Node, SQLite, Ollama)  
3. Run the frontend (Electron/Tauri)  
4. Run the backend server  
5. Run the background worker  

Detailed setup instructions will be added as components are implemented.

---

# Project Status

Neurologue is currently in **early design and scaffolding**.  
The next steps are:

- Implement SQLite schema  
- Build capture popup  
- Add background embedding worker  
- Add semantic search  
- Add theme clustering  
- Add export system  

See GitHub Issues for the full roadmap.

---

# License

TBD.
