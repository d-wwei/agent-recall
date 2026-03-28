# Agent Recall: AI Development Instructions

Agent Recall is a persistent memory system for Claude Code. Forked from claude-mem, it adds agent identity, bootstrap onboarding, and session recovery.

It captures tool usage, compresses observations using the Claude Agent SDK, and injects relevant context (including agent persona and active task state) into future sessions.

## Architecture

**5 Lifecycle Hooks**: SessionStart → UserPromptSubmit → PostToolUse → Summary → SessionEnd

**Hooks** (`src/hooks/*.ts`) - TypeScript → ESM, built to `plugin/scripts/*-hook.js`

**Worker Service** (`src/services/worker-service.ts`) - Express API on port 37777, Bun-managed, handles AI processing asynchronously

**Database** (`src/services/sqlite/`) - SQLite3 at `~/.agent-recall/agent-recall.db`

**Agent Persona** (`src/services/persona/`) - Agent identity and user profile storage with global/project scope

**Session Recovery** (`src/services/recovery/`) - Active task tracking and context injection for cross-session continuity

**Search Skill** (`plugin/skills/mem-search/SKILL.md`) - HTTP API for searching past work

**Bootstrap Skill** (`plugin/skills/bootstrap/SKILL.md`) - 3-round interview for initial setup

**Chroma** (`src/services/sync/ChromaSync.ts`) - Vector embeddings for semantic search

**Viewer UI** (`src/ui/viewer/`) - React interface at http://localhost:37777, built to `plugin/ui/viewer.html`

## Privacy Tags
- `<private>content</private>` - User-level privacy control (manual, prevents storage)

## Build Commands

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

## Configuration

Settings are managed in `~/.agent-recall/settings.json`. The file is auto-created with defaults on first run.

Backward compatibility: `CLAUDE_MEM_*` environment variables are still accepted. `AGENT_RECALL_*` variants take priority when both are set.

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/agent-recall/`
- **Database**: `~/.agent-recall/agent-recall.db`
- **Chroma**: `~/.agent-recall/vector-db/`
- **Legacy (auto-migrated)**: `~/.claude-mem/` → `~/.agent-recall/`

## Exit Code Strategy

- **Exit 0**: Success or graceful shutdown
- **Exit 1**: Non-blocking error (stderr shown to user, continues)
- **Exit 2**: Blocking error (stderr fed to Claude for processing)

## Requirements

- **Bun** (all platforms - auto-installed if missing)
- **uv** (all platforms - auto-installed if missing, provides Python for Chroma)
- Node.js

## Lineage

Forked from claude-mem v10.6.2 by Alex Newman (@thedotmack). Design patterns from claude-recall by d-wwei. See NOTICE file for full attribution.
