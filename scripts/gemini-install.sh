#!/bin/bash
# Agent Recall — Gemini CLI Installation
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GEMINI_CONFIG_DIR="${HOME}/.gemini"
AGENT_RECALL_ROOT="${PROJECT_ROOT}/plugin"

echo "Agent Recall — Installing for Gemini CLI"
echo ""

# Check if Gemini CLI is installed
if [ ! -d "$GEMINI_CONFIG_DIR" ]; then
  echo "Warning: Gemini CLI config directory not found at $GEMINI_CONFIG_DIR"
  echo "   Please install Gemini CLI first."
  exit 1
fi

# Create hooks directory
mkdir -p "$GEMINI_CONFIG_DIR/hooks"

# Copy hook configuration
echo "Installing hook configuration..."
HOOKS_SRC="${PROJECT_ROOT}/gemini-hooks/hooks.json"
if [ -f "$HOOKS_SRC" ]; then
  # Set AGENT_RECALL_ROOT in the hooks
  sed "s|\$AGENT_RECALL_ROOT|$AGENT_RECALL_ROOT|g" "$HOOKS_SRC" > "$GEMINI_CONFIG_DIR/hooks/agent-recall.json"
  echo "Hooks installed to $GEMINI_CONFIG_DIR/hooks/agent-recall.json"
else
  echo "Error: hooks.json not found at $HOOKS_SRC"
  exit 1
fi

echo ""
echo "Agent Recall installed for Gemini CLI!"
echo ""
echo "Start a Gemini session to begin capturing observations."
echo "View your memory: http://localhost:37777"
