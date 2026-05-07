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
