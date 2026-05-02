# Export Layer Architecture

The Export Layer makes Neurologue’s knowledge portable.

---

## Goals

- Allow external AI tools to reason over the user’s corpus
- Provide clean, structured exports
- Support both raw and processed data
- Keep exports local and private

---

## Export Types

### **1. Raw Entries**
```
entries.json
entries.md (optional)
```

### **2. Themes**
```
themes.json
themes.md (optional)
```

### **3. Embeddings**
```
embeddings.jsonl
/vector-db-folder
```


### **4. Full Export**
```
neurologue-export/
entries.json
themes.json
embeddings.jsonl
metadata.json
```

---

## Export Triggers

- Manual export
- Scheduled export (optional)
- On-demand export for external tools

---

## Future Enhancements

- Real‑time sync to folder
- Plugin system for custom exporters
