# Setup — Agent Recall Multi-Platform Installer

Detect installed AI coding tools and set up Agent Recall for each.

## Quick Start

Run the universal installer:
```bash
bash scripts/install.sh
```

This auto-detects and installs for all supported platforms:
- **Claude Code** — via plugin marketplace (`npm run sync-marketplace`)
- **Cursor** — hooks + rules file (`npm run cursor:install`)
- **Codex CLI** — hooks.json + AGENTS.md (`bash scripts/codex-install.sh`)
- **Gemini CLI** — hooks + config (`bash scripts/gemini-install.sh`)
- **OpenCode** — TypeScript plugin (`bash scripts/opencode-install.sh`)

## Shared Memory

All platforms share the same database at `~/.agent-recall/agent-recall.db`:
- Persona set up in Claude Code is visible in Cursor
- Observations from Codex appear in Gemini's context
- Archives and promotions work across all tools

## Per-Platform Setup

If you only want one platform, use the specific installer:
- `/codex-setup` — Codex CLI only
- `/gemini-setup` — Gemini CLI only
- `/cursor-setup` — Cursor only
- `/opencode-setup` — OpenCode only

## Verify

After installation, check the worker:
```bash
curl http://localhost:37777/health
```
