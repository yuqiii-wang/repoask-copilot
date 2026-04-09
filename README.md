# copilot-local-rag

A local development environment for the **@RepoAsk** VS Code extension. It combines a VS Code chat extension with a set of simulated backend servers (Confluence, Jira, log tail, file explorer) so the full RAG workflow can be developed and tested without connecting to real enterprise systems.

## Repository layout

```
repo-ask/          VS Code extension source (TypeScript)
dummy-servers/     Simulated backend servers (Python / FastAPI)
start.sh           One-shot build + server startup script
requirements.txt   Top-level Python deps (used by start.sh)
```

## Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 18 |
| npm | 9 |
| Python | 3.11 |
| `vsce` | installed globally or via npx |
| bash | Git Bash / WSL / macOS / Linux |

## Quick start — build and run everything

```bash
bash start.sh
```

`start.sh` does the following in order:

1. **Installs top-level Python deps** (`pip install -r requirements.txt`)
2. **Builds the extension** — `npm install`, `npm run compile`, then packages it with `npx vsce package`
3. **Kills any processes** already on ports 8091-8094
4. **Starts all four dummy servers** in the background with `nohup`

After it completes, install the generated `.vsix` into VS Code:

```bash
code --install-extension repo-ask/repo-ask-*.vsix
```

## Manual steps

### 1 — Build the extension only

```bash
cd repo-ask
npm install
npm run compile          # TypeScript → out/
npx vsce package --allow-missing-repository
```

The packaged extension is written to `repo-ask/repo-ask-<version>.vsix`.

### 2 — Start the dummy servers only

```bash
cd dummy-servers
pip install -r requirements.txt   # fastapi, uvicorn

python confluence_server.py    &  # port 8091
python jira_server.py          &  # port 8092
python logtail_server.py       &  # port 8093
python fileexplorer_server.py logs &  # port 8094
```

## Dummy servers

| Server | Port | Purpose |
|---|---|---|
| `confluence_server.py` | 8091 | Simulates Confluence REST API (pages, search) |
| `jira_server.py` | 8092 | Simulates Jira REST API (issues, projects) |
| `logtail_server.py` | 8093 | Serves log files from `dummy-servers/logs/` |
| `fileexplorer_server.py` | 8094 | Serves arbitrary files from a base directory |

### Log server URL parameters (`/logTail/{component}?file={filename}`)

| Param | Format | Description |
|---|---|---|
| `n` | integer | Return last N lines (tail) |
| `i` | text | Include only lines containing this text (plain-text response) |
| `e` | text | Exclude lines containing this text |
| `f` | `HH:MM` | Lines from this time onwards |
| `t` | `HH:MM` | Lines up to this time |

## Extension configuration

Open VS Code Settings and search for `repoAsk` to configure:

| Setting | Description |
|---|---|
| `repoAsk.confluence.url` | Base URL of the Confluence server (e.g. `http://localhost:8091`) |
| `repoAsk.confluence.securityToken` | Bearer token for Confluence |
| `repoAsk.jira.url` | Base URL of the Jira server (e.g. `http://localhost:8092`) |
| `repoAsk.logActionConfluenceUrl` | Confluence page URL shown on the "Log Action" feedback button |

## Chat participants

After installing the extension, two chat participants are available in VS Code Chat:

- **`@repoask`** — answers questions from the local document store using BM25 ranking + LLM verification
- **`@repoask /production-support`** — guided production incident investigation; runs `production-support-plan` then `production-support-main` to scan logs without sending raw log content to the LLM

## Development

```bash
# Watch mode (recompiles on save)
cd repo-ask
npm run watch

# Run extension in a new Extension Development Host window
# Press F5 in VS Code with repo-ask/ open
```
