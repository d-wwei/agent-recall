# Codex Setup — Agent Recall for Codex CLI

Set up Agent Recall persistent memory in Codex CLI.

## Quick Start

1. Build: `npm run build`
2. Install: `bash scripts/codex-install.sh`
3. The installer will:
   - Copy hooks.json to `~/.codex/hooks.json`
   - Enable `codex_hooks = true` in config.toml
   - Add Agent Recall context to `~/.codex/AGENTS.md`

## How It Works

Codex CLI's hook system is nearly identical to Claude Code's:
- SessionStart → starts worker + injects context
- PostToolUse → captures observations
- Stop → generates session summary
- Context delivered via AGENTS.md and hookSpecificOutput

## Verify

Start a Codex session and use any tool. Check:
- `GET http://localhost:37777/api/data/observations?limit=5`
