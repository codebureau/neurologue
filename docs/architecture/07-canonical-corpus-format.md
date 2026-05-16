# Canonical Corpus Format (CCF)

## 1. Purpose
The Canonical Corpus Format (CCF) defines Neurologue’s stable, portable representation of the user’s entire knowledge corpus.  
It provides a single, versioned contract for:
- exporting the corpus to external tools
- importing demo or external content
- future sync with cloud sources
- interoperability with NotebookLM, Microsoft Copilot, OneNote, and MCP clients

All import/export/sync features must use CCF as their foundation.

---

## 2. Design Principles
- Stable — versioned and backward‑compatible where possible.
- Loss‑minimising — round‑trip DB ↔ CCF without losing meaning.
- Extensible — supports future media, contradictions, domains, and agents.
- Human‑readable — JSONL and Markdown where appropriate.
- Deterministic — same corpus produces the same output.

---

## 3. Folder Layout

A CCF export produces a folder with the following structure:

```
entries.jsonl
themes.json
embeddings/
    entries.jsonl
media/
metadata.json
```

Each file is described in detail below.

---

## 4. File Specifications

### 4.1 entries.jsonl
Purpose: Stores all raw entries in the corpus.  
Each line is a complete JSON object representing one immutable note.

Example:
```json
{
  "id": "entry_2025-05-16T10:12:34.123Z_abc123",
  "created_at": "2025-05-16T10:12:34.123Z",
  "updated_at": "2025-05-16T10:12:34.123Z",
  "text": "Original note content…",
  "source": {
    "type": "user",
    "app": "neurologue",
    "external_id": null
  },
  "domain": "personal",
  "tags": ["project:x", "area:y"],
  "theme_ids": ["theme_abc", "theme_def"],
  "media_refs": [
    {
      "id": "media_001",
      "path": "media/whiteboard-2025-05-10.png",
      "type": "image",
      "mime": "image/png"
    }
  ],
  "metadata": {
    "pinned": false,
    "archived": false,
    "custom": {}
  }
}
```

Notes:
- id must be globally unique and stable across exports.
- domain supports personal/work separation.
- source.external_id enables future OneNote/OneDrive sync.
- theme_ids link into themes.json.

---

### 4.2 themes.json
Purpose: Stores all themes, their summaries, and membership.

Example:
```json
[
  {
    "id": "theme_abc",
    "name": "Work: Neurologue architecture",
    "created_at": "2025-05-10T09:00:00Z",
    "updated_at": "2025-05-16T10:00:00Z",
    "summary": "Notes about Neurologue's architecture, interoperability, and AI integration.",
    "entry_ids": ["entry_1", "entry_2"],
    "metrics": {
      "entry_count": 42,
      "first_entry_at": "2025-04-01T08:00:00Z",
      "last_entry_at": "2025-05-16T10:00:00Z"
    },
    "metadata": {
      "color": "#3366ff",
      "custom": {}
    }
  }
]
```

Notes:
- entry_ids provide explicit membership.
- summary is used by NotebookLM/Copilot exports.

---

### 4.3 embeddings/entries.jsonl
Purpose: Stores vector embeddings for each entry.

Example:
```json
{
  "entry_id": "entry_2025-05-16T10:12:34.123Z_abc123",
  "model": "all-minilm-2024-01",
  "vector": [0.0123, -0.4567, 0.9981],
  "created_at": "2025-05-16T10:12:40.000Z"
}
```

Notes:
- Embedding model metadata is required for compatibility.
- This file is the canonical representation even if a vector DB is used.

---

### 4.4 media/
Purpose: Stores referenced media files (images, audio, etc.).

Notes:
- Files are referenced by entries[].media_refs[].path.
- No global index is required initially.
- Future versions may add media/index.json.

---

### 4.5 metadata.json
Purpose: Stores global metadata about the export.

Example:
```json
{
  "format_version": "1.0.0",
  "exported_at": "2025-05-16T10:30:00Z",
  "app": {
    "name": "Neurologue",
    "version": "0.5.3"
  },
  "embedding": {
    "model": "all-minilm-2024-01",
    "dimension": 384
  },
  "notes": {
    "entry_count": 1234,
    "theme_count": 27
  },
  "custom": {}
}
```

Notes:
- format_version allows safe evolution of the format.
- Embedding metadata helps external tools interpret vectors.

---

## 5. Versioning
- The CCF is versioned via metadata.json → format_version.
- Breaking changes increment the major version.
- Importers must check format_version before processing.
- Older versions should be supported where feasible.

---

## 6. Import & Export Semantics

### Export
- Always produces a complete snapshot of the corpus.
- Scheduled exports may also produce a diff.json containing changed entry_ids.
- Export output must be deterministic.

### Import
- Demo content uses CCF import into a fresh library.
- Future sync will use source.external_id + timestamps to detect changes.
- Import is append‑only unless entry versioning is introduced.

---

## 7. Relationship to Other Features
- OneNote export: CCF → OneNote sections/pages
- NotebookLM export: CCF → NotebookLM bundle
- Copilot export: CCF → Copilot‑ready Markdown
- Scheduled exports: periodic CCF snapshots
- Demo content: CCF → DB import
- MCP server: may expose CCF bundles to external tools
- Agents: may use CCF snapshots for offline analysis

All interoperability features must be implemented as transformations of CCF.

---

## 8. Future Extensions
The CCF is designed to support future capabilities, including:
- Media embeddings
- Contradiction detection
- Entry versioning
- Domain‑level summaries
- Multi‑corpus support
- Richer metadata for agents
