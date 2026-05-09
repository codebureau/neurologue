# UI Shell Architecture

## Overview

Neurologue's main window uses a **nav-rail + view** shell model. A narrow left rail provides permanent top-level navigation between distinct perspectives; each perspective owns its own layout and chrome.

This document is the authoritative reference for where new features go visually. It should be updated whenever a new view is introduced.

---

## Shell Layout

```
┌──────┬────────────────────────────────────────────────────┐
│      │  #toolbar  (global — search, entry count, actions) │
│      ├────────────────────────────────────────────────────┤
│ nav  │                                                    │
│ rail │  #view-container  (active view fills this space)  │
│      │                                                    │
│      ├────────────────────────────────────────────────────┤
│      │  #status-bar  (global — Ollama + worker status)   │
└──────┴────────────────────────────────────────────────────┘
```

- **`#toolbar`** spans the full window width above the rail+content area.
- **`#nav-rail`** is ~48 px wide. Each item has an icon and a short text label. The active item is highlighted in teal.
- **`#view-container`** fills all remaining space. Only one view is visible at a time (`display:none` on inactive views).
- **`#status-bar`** spans the full window width below the rail+content area.
- Modals (Settings, Tag Management, Setup) are global overlays, not scoped to any view.

---

## Views

| ID | Nav label | Icon | Status | Milestone(s) |
|---|---|---|---|---|
| `view-library` | Library | ≡ | Implemented | Current |
| `view-themes` | Themes | ◈ | Placeholder | 0.4.1, 0.4.2, 0.4.4 |
| `view-priorities` | Priorities | ▲ | Placeholder | 0.7.x |
| `view-graph` | Graph | ⬡ | Placeholder | 0.6.2 |
| `view-explore` | Explore | ↺ | Placeholder | 0.6.1, 0.6.3, 0.6.4 |

Placeholder views show a centered "Coming soon" message until their milestone is implemented.

---

## View: Library

Three-column layout: sidebar | timeline | detail.

- **Left sidebar** — Tags (with counts), Categories, Themes (until Themes view is fully built)
- **Timeline** — entry list with controls (grouping, heatmap, infinite scroll), filter bar
- **Detail** — entry detail (read, edit, history, tag editing, category override, tag suggestions)

Toolbar items scoped to this view: Search, Text/Semantic toggle, entry count, Export, Maintenance (tag management), + New note.

---

## View: Themes

Two-column layout: theme list | theme detail.

Will contain:
- Theme list with name, entry count, and priority/energy indicators
- Theme detail: LLM summary, member entries, trend chart, contradiction badges
- Theme rename
- Evolution timeline (rising/falling energy)

Implemented in **0.4.1**, **0.4.2**, **0.4.4**.

---

## View: Priorities

Layout TBD — likely two-panel: ranked list | quadrant + drift chart.

Will contain:
- Theme list with E/V/O/M score bars
- Quadrant visualisation (Energy × Value axes)
- Drift analysis chart (theme energy over time)
- Click-through to Themes view for selected theme

Implemented in **0.7.4**, **0.7.5**.

---

## View: Graph

Full-canvas layout.

Will contain:
- Force-directed knowledge graph of entries and themes
- Semantic cluster visualisation
- Click to explore / open entry detail

Implemented in **0.6.2**.

---

## View: Explore

Split layout TBD.

Will contain:
- Cognitive dashboard (active themes, open loops, contradictions, thought density)
- Memory replay ("What was I thinking last month?", "What changed?")
- Agentic query interface

Implemented in **0.6.1**, **0.6.3**, **0.6.4**.

---

## Toolbar items by scope

| Item | Scope |
|---|---|
| Search bar + Text/Semantic toggle | Library only (hidden in other views) |
| Entry count | Library only |
| + New note | Global (always visible) |
| Export… | Global |
| Maintenance | Library only |
| ⚙ Settings | Global |
| Help | Global |

The toolbar adapts its visible items based on the active view.

---

## Design tokens

The rail uses the existing token set:

- Active item background: `var(--surface2)`
- Active item icon/label colour: `var(--cortex-teal)`
- Inactive item colour: `var(--text-dim)`
- Hover: `var(--text-muted)`
- Rail background: `var(--surface)` (same as sidebar)
- Rail border-right: `1px solid var(--border)`
