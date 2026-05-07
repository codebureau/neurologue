# Functional Requirements

## Capture Layer
- Global hotkey opens capture popup
- User can enter text
- User can paste clipboard content
- User can add optional tags (with comma-separated input)
- LLM tag suggestions shown inline when Ollama is available
- Entry is saved with timestamp
- No AI processing during capture (tag suggestions are opportunistic)

## Library Layer

### Timeline
- View raw entries in reverse-chronological order
- Infinite scroll (loads next 50 entries as user scrolls)
- Group entries by day, week, or month with date-range headers
- Activity heatmap: 52-week GitHub-style contribution graph
- Entry detail panel: full text, date, source, tags, category

### Search & Filtering
- Full-text search with 300ms debounce
- Semantic search using embeddings (falls back to text search if Ollama unavailable)
- Filter timeline by tag (clickable sidebar tag items and entry card tag pills)
- Filter timeline by category (clickable sidebar category items and entry card category badges)
- Combined filter: tag + category + text search, all active simultaneously (AND semantics)
- Active filter pills displayed above the timeline with individual clear (×) and "Clear all"

### Category System
- Entries are auto-classified into one of six categories: Task, Thought, Reminder, Idea, Question, Decision
- Category badge displayed on entry cards and in the detail panel
- User can override the auto-assigned category via a dropdown in the detail panel
- Categories sidebar section shows all categories with entry counts

### Tag Management
- View all tags with usage counts
- Rename a tag (all entries retagged automatically)
- Delete a tag (reference removed from all entries)
- Merge two tags: one is absorbed into the other, all entries retagged
- Duplicate detection:
  - Structural: format variants (hyphen/space/camel), abbreviations (dev ↔ development), plural-stem (tags ↔ tagging), spelling (Levenshtein distance)
  - Semantic: embedding cosine-similarity above configurable threshold
- Duplicate sensitivity setting: Strict / Balanced / Broad (controls similarity threshold)
- Entry detail panel: inline tag editing (add/remove tags, suggest tags via LLM)

### Theme View
- View entries by theme
- Related entries view

## Processing Layer
- Generate embeddings for new entries (nomic-embed-text via Ollama)
- Cluster entries into themes (k-means, local)
- Generate theme summaries (phi3:mini or configured model)
- Auto-classify entries by category (Task / Thought / Reminder / Idea / Question / Decision)
- Suggest tags for entries (LLM-generated, shown in detail panel and capture popup)
- Detect contradictions
- Identify open loops
- Worker status visible in the UI (processing indicator)

## Export Layer
- Export raw entries (JSON/Markdown)
- Export themes + summaries
- Export embeddings
- Full export bundle
