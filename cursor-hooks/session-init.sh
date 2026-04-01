#!/bin/bash
# Agent Recall - Cursor hook: session-init
# Delegates to worker service via bun-runner
_R="${AGENT_RECALL_ROOT:-$HOME/.claude/plugins/marketplaces/agent-recall/plugin}"
node "$_R/scripts/bun-runner.js" "$_R/scripts/worker-service.cjs" hook cursor session-init
