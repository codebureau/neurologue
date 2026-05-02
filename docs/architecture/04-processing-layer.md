# Processing Layer Architecture

The Processing Layer is the intelligence behind Neurologue.  
It runs asynchronously and never blocks the UI.

---

## Responsibilities

- Generate embeddings for new entries
- Cluster entries into themes
- Generate theme summaries
- Suggest tags
- Detect contradictions
- Identify open loops
- Maintain metadata (recency, activity)

---

## Processing Pipeline

### **1. Embedding Generation**
Triggered when:
- A new entry is added
- An entry is modified (rare)

Steps:
- Fetch entry
- Generate embedding via local model
- Store in vector DB

### **2. Clustering**
Runs periodically (e.g., every N entries or on demand):
- Fetch all embeddings
- Run k‑means or hierarchical clustering
- Create/update themes
- Update theme_entries with scores

### **3. Theme Summaries**
For each theme:
- Fetch top entries
- Generate summary using small LLM
- Store in themes.description

### **4. Tag Suggestions**
Optional:
- Use LLM or keyword extraction
- Suggest tags to user

### **5. Contradiction Detection**
Within each theme:
- Look for conflicting statements
- Flag for user review

### **6. Open Loop Detection**
Identify:
- Tasks
- Questions
- Unresolved items

---

## Models

### Embeddings
- `bge-small-en`
- `gte-small`

### LLM
- Phi‑3 Mini
- Qwen 2.5 3B

All models run via Ollama.

---

## Worker Requirements

- Runs in background
- Never blocks UI
- Logs errors locally
- Can be paused/resumed
