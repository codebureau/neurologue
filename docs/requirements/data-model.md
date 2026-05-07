# Data Model

## entries
- id (PK)
- created_at (datetime)
- edited_at (datetime, nullable) — set on any content edit
- content (text)
- original_content (text, nullable) — preserved on first edit
- source (text)
- type (text)  // note, idea, task, etc.
- category (text, nullable) — LLM-assigned category (Task / Thought / Reminder / Idea / Question / Decision)
- user_category (text, nullable) — user override; takes precedence over `category` when set
- metadata (json)

## tags
- id (PK)
- name (text, unique)

## entry_tags
- entry_id (FK → entries.id)
- tag_id (FK → tags.id)

## entry_revisions
- id (PK)
- entry_id (FK → entries.id)
- content (text) — snapshot of content before this edit
- edited_at (datetime)

## embeddings
- entry_id (FK → entries.id)
- vector (blob)
- model_name (text)

## themes
- id (PK)
- name (text)
- description (text)

## theme_entries
- theme_id (FK → themes.id)
- entry_id (FK → entries.id)
- score (float)

---

## Notes

### Category resolution
The effective category for an entry is `COALESCE(user_category, category)`. The `user_category` column is written only when the user explicitly changes the category in the UI.

### Tag similarity thresholds
The `tagSimilarityThreshold` setting (default `0.88`) is a cosine-similarity floor for semantic duplicate detection. The `tagSuggestionFormat` setting (default `hyphenated`) controls the format LLM-generated tag suggestions are normalised to.

