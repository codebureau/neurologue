# Neurologue MCP Server

Neurologue ships a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes your note corpus to external AI tools such as **Claude Desktop**, **Cursor**, and **VS Code Copilot**.

## Enabling the server

1. Open Neurologue → **Settings** → **MCP Server**.
2. Check **Enable MCP server**.
3. Choose a port (default: `3737`). A bearer token is auto-generated; copy it for use below.
4. Click **Save settings**. The status line will update to *Running on http://127.0.0.1:3737/mcp*.

The server starts automatically on the next launch when enabled.

## Connecting Claude Desktop

Claude Desktop uses a **stdio** connection (it launches Neurologue's MCP entry point as a subprocess). Click **Copy Claude Desktop config** in Settings to get the correct snippet for your machine, then paste it into `claude_desktop_config.json`.

The config looks like this:

```json
{
  "mcpServers": {
    "neurologue": {
      "command": "node",
      "args": ["/path/to/neurologue/src/mcp/stdio.js"]
    }
  }
}
```

`claude_desktop_config.json` is located at:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows (traditional install) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Windows (Microsoft Store) | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |

> **Note:** Claude Desktop may not create the `Claude` folder automatically. Create it manually if it does not exist.

Fully quit and restart Claude Desktop after saving (use the system tray/menu bar quit option, not just closing the window). The tools will appear in the tool picker. The Neurologue tools will appear in the tool picker.

## Connecting Cursor

In Cursor → Settings → MCP, add a new server:

```json
{
  "neurologue": {
    "url": "http://127.0.0.1:3737/mcp",
    "headers": {
      "Authorization": "Bearer <your-token>"
    }
  }
}
```

## Available tools

| Tool | Description |
|---|---|
| `search_notes` | Search notes by text and semantic similarity |
| `list_themes` | List all detected themes with entry counts |
| `get_theme_entries` | Get notes belonging to a named theme |
| `create_note` | Create a new note in the corpus |
| `summarise_topic` | Summarise notes on a topic using the local LLM |
| `run_agent` | Run a Neurologue agent (daily-digest, weekly-review, monthly-themes) |

### search_notes

```
search_notes(query: string, limit?: number) → text
```

Searches using both full-text and semantic (vector) similarity. Returns up to `limit` matching notes (default 10).

### list_themes

```
list_themes() → text
```

Returns all themes currently detected in your corpus with entry counts and descriptions.

### get_theme_entries

```
get_theme_entries(theme_name: string, limit?: number) → text
```

Returns notes assigned to a theme. Matches on partial theme name (case-insensitive).

### create_note

```
create_note(content: string, tags?: string[]) → text
```

Creates a new note in your corpus. The note is queued for background embedding and classification automatically.

### summarise_topic

```
summarise_topic(topic: string, limit?: number) → text
```

Retrieves the most relevant notes and asks the local LLM to synthesise a summary. Requires Ollama to be running.

### run_agent

```
run_agent(agent_id: string) → text
```

Runs a pre-built Neurologue agent and returns its full output. Available agents:
- `daily-digest` — summary of today's entries
- `weekly-review` — themes and highlights from the past week
- `monthly-themes` — cluster analysis for the past month

## Security

The MCP server binds to `127.0.0.1` only — it is not accessible from other machines on your network. The bearer token provides an additional layer of authentication for local processes. To rotate the token, click **Regenerate** in Settings and save.
