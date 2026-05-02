# Copilot Agent Guidelines

You are assisting in the development of Neurologue, a local‑first cognitive system.

## Follow These Rules

### 1. Respect the Architecture
All code must follow the design in `/docs/architecture`.

### 2. Respect the Requirements
Functional and non‑functional requirements are in `/docs/requirements`.

### 3. Local‑First Only
- No cloud APIs
- No external services
- No telemetry

### 4. Use the Correct Tech Stack
- SQLite for structured data
- Local vector DB for embeddings (ChromaDB)
- Small LLMs via Ollama
- Electron/Tauri for frontend
- Python for backend worker

### 5. Keep Layers Separate
- Capture = fast, no AI
- Library = structured storage
- Processing = background AI
- Export = portable data

### 6. Code Placement
- `/src/frontend` → UI
- `/src/backend` → DB + API
- `/src/worker` → processing
- `/src/db` → schema + migrations

### 7. Ask for Clarification When Needed
If requirements are ambiguous, request clarification before generating code.

### 8. General Development Process
- Development tasks are documented in GitHub Issues in the repository
- Each issue must be developed in its own branch
- Plans must be presented before commencing development
- Branches must be resolved via pull request
- NO commits directly to main