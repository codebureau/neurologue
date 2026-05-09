# Neurologue Roadmap

Neurologue is evolving into a stable, local‑first cognitive layer that captures thoughts, identifies themes, and surfaces meaningful patterns over time. This roadmap outlines the planned feature areas and the sequence in which they will be developed.

Each roadmap item is written to be convertible into GitHub Issues.

---

## 0.2.x — Foundations & Runtime

### 0.2.1 Application Packaging
- Package Neurologue as a standalone desktop app (Windows/macOS/Linux)
- Provide installer and portable modes (NSIS installer + portable ZIP on Windows; DMG + ZIP on macOS; AppImage + deb on Linux)
- Ensure global hotkey works in packaged builds
- GitHub Actions workflow builds and attaches artifacts on version tags
- ~~Add UI to configure global hotkey~~ — delivered in 0.2.3

### 0.2.2 Ollama Detection & Setup
- Detect whether Ollama is installed
- Provide guided installation flow
- Detect installed models
- Pull required models automatically (`nomic-embed-text`, `phi3:mini`)
- Allow user to choose alternative models

### 0.2.3 Ollama Runtime Control
- Detect whether Ollama is running
- ~~Start/stop Ollama from within Neurologue~~ — not supported; Ollama on Windows manages its own lifecycle as a tray application
- Display model load status and basic resource usage
- Provide graceful fallback when Ollama is offline
- Configure global capture hotkey (conflict detection, persisted setting)

### 0.2.4 Background Worker Visibility
- Add worker status indicator (online/offline)
- Show queue length and last processed entry
- Display embedding model in use
- Auto‑refresh UI when new entries/themes are processed

---

## 0.3.x — Capture & Library Enhancements

### 0.3.1 Markdown Support
- Add optional Markdown formatting in the capture popup
- Provide inline formatting toolbar
- Add “paste as plain text” toggle
- Evaluate embedding impact of Markdown tokens

### 0.3.2 Editing Model
- Support soft edits (edit text but preserve original in metadata)
- Support append‑only edits (new version as new entry)
- Optional full edit mode (user‑configurable)
- Display version history when applicable

### 0.3.3 Entry Categorisation (Implicit)
- Use LLM inference to classify entries as:
  - Task
  - Thought
  - Reminder
  - Idea
  - Question
  - Decision
- Store category as metadata
- Allow user override

### 0.3.4 Tag UX Improvements
- Add visual styling for tags (chips, colours)
- Add tag suggestions (LLM‑generated)
- Support tag merging and renaming

### 0.3.5 Timeline Improvements
- Infinite scroll
- Group entries by day/week/month
- Add activity heatmap (GitHub‑style)

---

## 0.7.x — Neurologue Priority Model

### 0.7.1 Priority Data Model
- Add `ThemeMetrics` table (time-sliced E/V/O/M + priority score per theme)
- Add `EntrySignals` table (per-entry sentiment, emotional intensity, obligation/motivation/value/open-loop flags)
- Wire into existing entry/theme system via DB migrations

### 0.7.2 Entry Signal Classification
- LLM classification call on entry ingestion to produce `EntrySignals`
- JSON prompt with structured output (sentiment, emotional intensity, flags)
- Feature flag to enable/disable classification
- Error handling for JSON parse failures

### 0.7.3 Priority Scoring Pipeline
- Aggregation job to compute E, V, O, M, and final Priority score per theme
- Scores normalised to 0–1 range
- Runs on schedule (e.g. hourly) and on demand
- Debug endpoint for inspection

### 0.7.4 Priority Dashboard UI
- New **Priorities** view in the nav rail
- Theme list with E/V/O/M score bars
- Quadrant visualisation (Energy × Value axes)
- Click-through to full theme detail

### 0.7.5 Drift Analysis
- Time-series graph of theme energy and priority drift
- Highlight rising and falling themes
- Detect neglected obligations (high O, declining E)

---

## 0.4.x — Themes & Cognitive Layer

### 0.4.1 Theme Naming & Summaries
- Generate human‑readable theme names
- Allow user to rename themes
- Improve theme summaries using LLM

### 0.4.2 Theme Evolution Over Time
- Track theme prevalence over time
- Show trend lines (increasing/decreasing)
- Detect theme birth/merge/split events
- Add “What’s on your mind lately?” view

### 0.4.3 Semantic Neighbours
- Show related entries for any entry
- Show nearest‑neighbour clusters
- Provide “similar thoughts” navigation

### 0.4.4 Contradiction Detection
- Detect conflicting statements
- Group contradictions into clusters
- Provide “resolve contradiction” workflow

---

## 0.5.x — Interoperability & Export

### 0.5.1 Export Formats
- Markdown bundle export
- JSONL export
- Vector DB export
- OneNote export (pages grouped by theme)
- NotebookLM‑ready export
- Microsoft Copilot‑ready export

### 0.5.2 Scheduled Exports
- Daily/weekly automatic export
- Export diff since last export
- Export to custom folder locations

---

## 0.6.x — Advanced Insights

### 0.6.1 Cognitive Dashboard
- Unified dashboard showing:
  - Active themes
  - Emerging themes
  - Open loops
  - Contradictions
  - Recent captures
  - Thought density over time

### 0.6.2 Knowledge Graph
- Visual graph of entries, themes, and relationships
- Force‑directed layout
- Click to explore clusters

### 0.6.3 Memory Replay
- “What was I thinking about last month”
- “What changed between two time periods”
- “What ideas have I abandoned”

### 0.6.4 Agentic Extensions
- Local agents that operate on your corpus
- Example actions:
  - Summarise my week
  - Find all tasks I haven’t closed
  - Identify emerging priorities
  - Suggest focus areas for today

---

## Issue Generation Guide (Optional)

<!--
ISSUE_GENERATION_GUIDE:
- Each roadmap item should become one GitHub Issue.
- Use the title exactly as written.
- Include acceptance criteria.
- Include technical notes where relevant.
- Link issues to the appropriate milestone (0.2.x, 0.3.x, etc.).
-->
