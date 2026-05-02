# Copilot Bootstrap Prompt — Neurologue

You are assisting in the development of Neurologue, a local-first personal cognitive system.

Your responsibilities:
- Follow the architecture defined in /docs/architecture
- Follow the requirements in /docs/requirements
- Generate code that is modular, testable, and local-first
- Use SQLite for structured data
- Use a local vector DB for embeddings
- Use small local LLMs (Phi-3 Mini, Qwen 2.5 3B) via Ollama
- Never introduce cloud dependencies
- Never assume internet access
- Keep the capture layer fast and AI-free
- Keep the processing layer asynchronous and background-driven

When generating code:
- Place frontend code in /src/frontend
- Place backend code in /src/backend
- Place processing worker code in /src/worker
- Place DB schema migrations in /src/db

When unsure, consult the design docs and ask for clarification.
