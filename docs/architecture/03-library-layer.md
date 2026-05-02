# Library Layer Architecture

The Library Layer is the structured store of all captured and processed knowledge.

---

## Responsibilities

- Store raw entries
- Store tags
- Store embeddings
- Store AI‑generated structures (themes, summaries)
- Provide multiple views
- Support semantic and full‑text search
- Act as the system’s source of truth

---

## Views

### **1. Timeline View**
- Chronological list of entries
- Filters: date range, tags, themes

### **2. Tag View**
- Manual tags
- Suggested tags (future)
- Tag → entries

### **3. Theme View**
- AI‑generated clusters
- Theme summary
- Theme entries sorted by relevance

### **4. Semantic Search**
- Query → embedding → similarity search
- Returns ranked entries

### **5. Entry Detail View**
- Raw text
- Tags
- Related entries
- Theme membership
- Metadata

---

## Storage

### **SQLite**
Stores:
- entries
- tags
- entry_tags
- themes
- theme_entries

### **Vector DB**
Stores:
- embeddings
- model metadata

Options:
- Chroma
- LanceDB
- SQLite blob column (fallback)

---

## Performance Requirements

- Must handle thousands of entries smoothly
- Semantic search < 200ms for typical datasets
- UI must remain responsive during background processing

---

## Future Enhancements

- Knowledge graph view
- Multi‑dimensional filtering
- Custom saved views
