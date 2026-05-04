# Set your repository here
$repo = "codebureau/neurologue"

Write-Host "Creating issues..." -ForegroundColor Cyan

function New-Issue {
    param(
        [string]$Title,
        [string]$Body
        # [string]$Milestone   # Uncomment later if you want milestone assignment
    )

    gh issue create `
        -R $repo `
        --title $Title `
        --body $Body
        # --milestone $Milestone   # Uncomment after milestones exist

    Write-Host "Created: $Title" -ForegroundColor Yellow
}

# -------------------------
# 0.2.x FOUNDATIONS
# -------------------------

New-Issue "Package Neurologue as a standalone desktop app" @"
Create packaged builds for Windows, macOS, and Linux so Neurologue can run without npm start.

**Acceptance Criteria:**
- Builds run without Node/npm installed
- Global hotkey works in packaged builds
- App auto-launches background worker
- Installer + portable ZIP both available

**Technical Notes:**
- Electron Forge or Tauri
- Code signing optional
"@

New-Issue "Add UI to configure global hotkey" @"
Allow users to change the global capture hotkey.

**Acceptance Criteria:**
- UI for selecting hotkey
- Conflict detection
- Persisted setting
"@

New-Issue "Detect whether Ollama is installed" @"
Check for Ollama installation on startup.

**Acceptance Criteria:**
- Detect install path
- Detect version
- Show installation prompt if missing
"@

New-Issue "Guided Ollama installation flow" @"
Provide a guided UI to help users install Ollama.

**Acceptance Criteria:**
- Install button
- Opens correct installer
- Re-check installation after completion
"@

New-Issue "Detect installed Ollama models" @"
List installed models and their sizes.

**Acceptance Criteria:**
- Detect embedding model
- Detect LLM model
- Show missing models
"@

New-Issue "Auto-pull required Ollama models" @"
Automatically pull nomic-embed-text and phi3:mini if missing.

**Acceptance Criteria:**
- Pull models on demand
- Show progress indicator
- Retry on failure
"@

New-Issue "Start/stop Ollama from within Neurologue" @"
Add controls to start or stop the Ollama service.

**Acceptance Criteria:**
- Detect running state
- Start/stop buttons
- Error handling
"@

New-Issue "Display Ollama runtime status" @"
Show whether Ollama is running and which models are loaded.

**Acceptance Criteria:**
- Running/not running indicator
- Model load status
- Basic CPU/RAM usage
"@

New-Issue "Background worker status indicator" @"
Show whether the embedding worker is active.

**Acceptance Criteria:**
- Worker online/offline
- Queue length
- Last processed entry
"@

New-Issue "Auto-refresh UI when new entries/themes are processed" @"
Ensure the UI updates automatically when the worker finishes processing.

**Acceptance Criteria:**
- New entries appear without reload
- Themes update automatically
"@

# -------------------------
# 0.3.x CAPTURE & LIBRARY
# -------------------------

New-Issue "Add Markdown support to capture popup" @"
Enable optional Markdown formatting in the capture UI.

**Acceptance Criteria:**
- Markdown toggle
- Inline formatting toolbar
- Preview mode
"@

New-Issue "Add 'paste as plain text' toggle" @"
Allow users to paste without formatting.

**Acceptance Criteria:**
- Toggle in capture popup
- Strips formatting reliably
"@

New-Issue "Implement soft edit model" @"
Allow editing entries while preserving the original text in metadata.

**Acceptance Criteria:**
- Edit UI
- Original text preserved
- Version history view
"@

New-Issue "Implement append-only edit model" @"
Edits create a new entry linked to the original.

**Acceptance Criteria:**
- New entry created
- Link displayed in UI
"@

New-Issue "Add LLM-based entry categorisation" @"
Automatically classify entries (Task, Thought, Reminder, Idea, Question, Decision).

**Acceptance Criteria:**
- Category assigned automatically
- User can override
- Stored in metadata
"@

New-Issue "Improve tag styling" @"
Add visual styling for tags.

**Acceptance Criteria:**
- Tag chips
- Colours
- Hover states
"@

New-Issue "Add tag suggestions" @"
Use LLM to suggest tags based on entry content.

**Acceptance Criteria:**
- Suggestions appear during capture
- Click to apply
"@

New-Issue "Add tag merging and renaming" @"
Allow users to clean up tag taxonomy.

**Acceptance Criteria:**
- Merge tags
- Rename tags
- Update all linked entries
"@

New-Issue "Improve timeline view" @"
Enhance the timeline with grouping and heatmaps.

**Acceptance Criteria:**
- Infinite scroll
- Group by day/week/month
- Activity heatmap
"@

# -------------------------
# 0.4.x COGNITIVE LAYER
# -------------------------

New-Issue "Generate human-readable theme names" @"
Replace generic theme names with meaningful ones.

**Acceptance Criteria:**
- LLM-generated names
- User can rename themes
"@

New-Issue "Improve theme summaries" @"
Generate richer summaries for each theme.

**Acceptance Criteria:**
- Multi-sentence summaries
- Updated when new entries added
"@

New-Issue "Track theme evolution over time" @"
Show how themes rise or fall in prevalence.

**Acceptance Criteria:**
- Trend lines
- Theme birth/death
- Merge/split detection
"@

New-Issue "Add 'What's on your mind lately?' view" @"
Show the most active themes in the recent period.

**Acceptance Criteria:**
- Last 7/30 day view
- Ranked by activity
"@

New-Issue "Add semantic neighbours view" @"
Show related entries for any entry.

**Acceptance Criteria:**
- Nearest-neighbour list
- Click to navigate
"@

New-Issue "Implement contradiction detection" @"
Detect conflicting statements across entries.

**Acceptance Criteria:**
- Contradiction clusters
- Highlight conflicting entries
- 'Resolve contradiction' workflow
"@

# -------------------------
# 0.5.x INTEROPERABILITY
# -------------------------

New-Issue "Add export formats (Markdown, JSONL, Vector DB)" @"
Support multiple export formats.

**Acceptance Criteria:**
- Markdown bundle
- JSONL
- Vector DB folder
"@

New-Issue "Add OneNote export" @"
Export entries/themes into OneNote pages.

**Acceptance Criteria:**
- OneNote section per theme
- Entries grouped chronologically
"@

New-Issue "Add NotebookLM export" @"
Export corpus in a NotebookLM-friendly structure.

**Acceptance Criteria:**
- JSON/Markdown bundle
- Theme summaries included
"@

New-Issue "Add Copilot-ready export" @"
Export corpus in a structure optimised for Microsoft Copilot ingestion.

**Acceptance Criteria:**
- Markdown bundle
- Theme summaries
- Metadata preserved
"@

New-Issue "Add scheduled exports" @"
Allow automatic daily/weekly exports.

**Acceptance Criteria:**
- Schedule picker
- Export diff since last run
- Custom folder selection
"@

# -------------------------
# 0.6.x ADVANCED INSIGHTS
# -------------------------

New-Issue "Build cognitive dashboard" @"
A unified dashboard showing high-level cognitive signals.

**Acceptance Criteria:**
- Active themes
- Emerging themes
- Open loops
- Contradictions
- Recent captures
- Thought density
"@

New-Issue "Build interactive knowledge graph" @"
Visual graph of entries, themes, and relationships.

**Acceptance Criteria:**
- Force-directed graph
- Click to explore
- Theme clusters
"@

New-Issue "Add memory replay" @"
Replay what you were thinking about over time.

**Acceptance Criteria:**
- Month-by-month view
- Change detection
- Abandoned ideas list
"@

New-Issue "Add agentic extensions" @"
Local agents that operate on the user’s corpus.

**Acceptance Criteria:**
- Summarise my week
- Find open tasks
- Identify emerging priorities
- Suggest focus areas
"@

Write-Host "`nAll issues created successfully." -ForegroundColor Green
