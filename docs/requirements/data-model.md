# Data Model

## entries
- id (PK)
- created_at (datetime)
- content (text)
- source (text)
- type (text)  // note, idea, task, etc.
- metadata (json)

## tags
- id (PK)
- name (text)

## entry_tags
- entry_id (FK)
- tag_id (FK)

## embeddings
- entry_id (FK)
- vector (blob)
- model_name (text)

## themes
- id (PK)
- name (text)
- description (text)

## theme_entries
- theme_id (FK)
- entry_id (FK)
- score (float)
