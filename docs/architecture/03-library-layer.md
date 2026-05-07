# Library Layer Architecture

The Library Layer is the structured store of all captured and processed knowledge.

---

## Responsibilities

- Store raw entries (with edit history and category fields)
- Store tags
- Store embeddings
- Store AI-generated structures (themes, summaries)
- Provide multiple views
- Support semantic and full-text search
- Filter by tag, category, and text (combined AND)
- Tag management (rename, delete, merge, duplicate detection)
- Entry categorisation (auto + user override)
- Act as the system’s source of truth

---

## Views

### **1. Timeline View**
- Reverse-chronological list of entries with infinite scroll (page size: 50)
- Grouping modes: None (flat), Day, Week, Month — inserts date-range headers between groups
- Activity heatmap: 52-week GitHub-style contribution graph (cell counts = entries per day)
- Entries display: content preview, tags (clickable pills), category badge (clickable)

### **2. Tag View / Tag Management**
- Sidebar: all tags with entry counts; clicking a tag applies a tag filter
- Tag management panel (opened via Maintenance toolbar button):
  - Rename, delete, merge tags
  - Duplicate detection pane: structural pairs + semantic pairs (cosine-similarity)
  - Sensitivity control (Strict / Balanced / Broad) maps to `tagSimilarityThreshold` setting

### **3. Categories View**
- Sidebar section: all categories with entry counts
- Clicking a category applies a category filter
- Category resolution: `COALESCE(user_category, category)` — user override takes precedence

### **4. Filtering**
- Filter bar displayed above the timeline when any filter is active
- Active filter pills (tag pill + category pill) each have an individual × clear
- “Clear all” removes all active filters at once
- Tag filter + category filter + text search combine with AND semantics
- Filter state is maintained across pagination (infinite scroll respects active filters)

### **5. Semantic Search**
- Query → embedding → similarity search
- Returns ranked entries
- Falls back to text search if Ollama is unavailable

### **6. Entry Detail View**
- Raw text
- Tags (add/remove inline; LLM tag suggestions)
- Category badge + dropdown to override
- Related entries
- Theme membership
- Metadata (created_at, source, edited_at if edited)

### **7. Theme View**
- AI-generated clusters
- Theme summary
- Theme entries sorted by relevance

---

## Storage

### **SQLite**
Stores:
- entries (includes `category`, `user_category`, `edited_at`, `original_content`)
- tags
- entry_tags
- entry_revisions
- themes
- theme_entries

### **Vector DB**
Stores:
- embeddings
- model metadata

Implementation: LanceDB (primary), SQLite blob column (fallback)

---

## Performance Requirements

- Must handle thousands of entries smoothly
- Infinite scroll loads 50 entries per page with no perceptible lag
- Semantic search < 200ms for typical datasets
- UI must remain responsive during background processing

---

## Future Enhancements

- Knowledge graph view
- Custom saved views
- Multi-tag filter (select multiple tags simultaneously)
