# Cursor Setup — Agent Recall for Cursor IDE

Set up Agent Recall persistent memory in Cursor.

## Quick Start

1. Build the project: `npm run build`
2. Install Cursor hooks: `npm run cursor:install`
3. Check status: `npm run cursor:status`

## What Gets Installed

- Hook scripts in `~/.cursor/hooks/` that capture tool usage
- Context file at `.cursor/rules/agent-recall-context.mdc` (auto-updated)
- MCP server config for search tools

## Verify

After installing, open a Cursor session and use any tool. Then check:
- `GET http://localhost:37777/api/data/observations?limit=5` should show new observations
- `.cursor/rules/agent-recall-context.mdc` should have recent context
