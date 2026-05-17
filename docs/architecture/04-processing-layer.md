# Processing Layer Architecture

The Processing Layer is the intelligence behind Neurologue.  
It runs asynchronously and never blocks the UI.

---

## Responsibilities

- Generate embeddings for new entries
- Cluster entries into themes
- Generate theme summaries
- Auto-classify entries by category
- Suggest tags
- Detect contradictions
- Identify open loops
- Maintain metadata (recency, activity)

---

## Processing Pipeline

### **1. Embedding Generation**
Triggered when:
- A new entry is added
- An entry is modified

Steps:
- Fetch entry
- Generate embedding via `nomic-embed-text` (Ollama)
- Store in vector DB

### **2. Clustering**
Runs after every 5 new embeddings:
- Fetch all embeddings
- Run k-means clustering (local, no LLM required)
- Create/update themes
- Update theme_entries with scores

### **3. Theme Summaries**
For each theme:
- Fetch top entries
- Generate summary using configured LLM (default: `phi3:mini`)
- Store in themes.description

### **4. Entry Categorisation**
For each newly embedded entry:
- Prompt the LLM with the entry content
- Classify into one of: **Task, Thought, Reminder, Idea, Question, Decision**
- Store result in `entries.category`
- User may override via `entries.user_category`; effective category = `COALESCE(user_category, category)`

### **5. Tag Suggestions**
- Triggered from entry detail panel (user-initiated) or capture popup (opportunistic)
- Prompts LLM with entry content and existing tags
- Returns a short list of suggested tags in the configured format (e.g. hyphenated)
- User adds suggestions individually; none are applied automatically

### **6. Contradiction Detection**
Within each theme:
- Look for conflicting statements
- Flag for user review

### **7. Open Loop Detection**
Identify:
- Tasks
- Questions
- Unresolved items

---

## Models

### Embeddings
- `nomic-embed-text` (default; configurable via `src/config.js`)

### LLM
- `phi3:mini` (default; configurable via Settings → LLM Model)
- Fallback / alternatives: `qwen2.5:3b`

All models run locally via Ollama (`http://127.0.0.1:11434` by default).

---

## Worker Requirements

- Runs in background (Node.js worker thread)
- Never blocks UI
- Logs errors locally
- Worker status indicator shown in library window
- Gracefully skips ticks when Ollama is unavailable

---

## Architectural Decision: Polling vs Event-Driven

### Current approach — polling background worker

The worker runs on a fixed tick interval (default: 60 s embedding, 300 s clustering, 900 s contradiction scan). Each tick it queries the DB for work to do, processes a capped batch, and goes back to sleep.

**Why this is the right choice now:**
- Simple to reason about — all processing state lives in the DB, not in memory queues.
- Naturally resilient: if Ollama is unavailable, the tick is skipped and nothing is lost. Work is re-discovered on the next tick via DB queries rather than dropped from a queue.
- No ordering guarantees needed — embedding, clustering, and contradiction detection are all idempotent and commutative.
- The corpus is small enough that polling overhead is negligible.
- A self-validating freshness cache (`checked_pairs.checked_at` vs `entries.edited_at`) means even the contradiction scan doesn't need explicit event hooks when entries change.

**Limitations to watch for:**

| Symptom | Threshold to watch |
|---|---|
| Embedding backlog grows faster than tick rate clears it | > ~500 unembedded entries |
| Contradiction scan misses edits within the polling window | User edits many entries in quick succession |
| UI feels unresponsive to changes | Visible lag > one tick interval |
| Worker and main process contend on SQLite | Write-heavy imports + simultaneous scans |

### Event-driven alternative

An event-driven approach would have the main process publish events (`entry:created`, `entry:updated`, `entry:deleted`) onto an in-process queue. Worker consumers subscribe to specific event types and process work immediately rather than on the next tick.

**Advantages over polling:**
- Lower latency — embedding fires the moment an entry is saved, not up to 60 s later.
- No unnecessary DB queries when there's nothing to do.
- Natural cancellation — in-flight work for a deleted entry can be dropped from the queue before it starts.

**Why we haven't done it yet:**
- Adds coordination complexity: queue persistence, back-pressure, at-least-once delivery guarantees.
- Resilience now requires the queue itself to survive crashes, not just the DB.
- Ollama unavailability requires queue pausing rather than a simple tick skip.
- The current polling approach is already fast enough for single-user, local-first use.

**Migration path if needed:**  
The cleanest route would be to introduce a lightweight `work_queue` table in SQLite (event type, entity id, enqueued_at, status). The worker subscribes to DB changes via a watcher rather than a timer. This keeps the DB-as-source-of-truth property while gaining event responsiveness without an external message broker.
