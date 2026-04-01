#!/bin/bash
# Agent Recall - Cursor hook: save-file-edit
# File edits are treated as observations
# Delegates to worker service via bun-runner
_R="${AGENT_RECALL_ROOT:-$HOME/.claude/plugins/marketplaces/agent-recall/plugin}"
node "$_R/scripts/bun-runner.js" "$_R/scripts/worker-service.cjs" hook cursor observation
