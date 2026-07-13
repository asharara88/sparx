# MCP Setup — connecting Claude to this project's servers

Anthropic designed and open-sourced the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), so Claude Code and Claude Desktop both have native support for connecting to MCP servers. This repo ships a project-scoped config in [`.mcp.json`](../.mcp.json); this page explains what's in it, how to mirror it in Claude Desktop, and how to keep the setup fast.

## Servers configured in `.mcp.json`

| Server | Transport | Purpose |
| --- | --- | --- |
| `supabase` | HTTP | The "sparx studio" Supabase project. Authenticate once via `/mcp` in an interactive Claude Code session. |
| `claude-in-chrome` | Extension | Supervised browser control via the Claude in Chrome extension. |
| `filesystem` | stdio (`npx @modelcontextprotocol/server-filesystem`) | File read/search/write, sandboxed to this repo. |
| `github` | stdio (`npx @modelcontextprotocol/server-github`) | Repos, issues, and PRs via a personal access token. |

Claude Code picks these up automatically when you open the repo. Two things are intentional:

- **The filesystem server is scoped to `.` (this project), not your home directory.** Keep it that way — see [Keep the tool context minimal](#a-keep-the-tool-context-minimal).
- **The GitHub token is *not* stored in the file.** `.mcp.json` references `${GITHUB_PERSONAL_ACCESS_TOKEN}`, which Claude Code expands from your environment at launch. Export it in your shell profile:

  ```sh
  export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_..."
  ```

  Never paste a real token into `.mcp.json` — the file is committed.

## Connecting Claude Desktop to the same servers

Claude Desktop reads its own config file rather than `.mcp.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Define the servers under `mcpServers`. Claude Desktop does not do env-var expansion and has no project cwd, so use an absolute path for the filesystem sandbox and put the token directly in this file (it lives outside any repo, which is fine):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/absolute/path/to/sparx"
      ]
    },
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

Restart Claude Desktop after editing; a plug icon appears once the servers are connected and Claude can read files, query GitHub, etc.

## Optimizing Claude's performance with MCP

### A. Keep the tool context minimal

Claude can get overwhelmed if a server returns thousands of lines of raw data:

- Write custom wrapper scripts (or configure servers) to paginate or summarize responses.
- Restrict the filesystem server to the specific project directory you're working on — never your entire home directory. This is why our `.mcp.json` pins it to the repo root.

### B. Build a "local development agent"

Combining the filesystem MCP with a sequential-thinking or command-runner MCP turns Claude Desktop into an autonomous developer that can:

1. Read a bug report.
2. Search the codebase.
3. Modify the files.
4. Run tests and fix errors automatically.

(Claude Code already does all of this natively — this pattern matters mainly for Claude Desktop.)

### C. Bridge LLMs (Claude & Gemini)

To let Claude drive Google's video/image models (Veo, Imagen), build or run a custom Python/Node MCP server that wraps the Google Gen AI SDK. Once it's configured in the JSON, Claude can generate videos/images inline during chats — relevant here if we ever want the studio pipeline to compare providers.
