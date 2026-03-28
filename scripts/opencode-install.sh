#!/bin/bash
# Agent Recall — OpenCode Installation
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Agent Recall — Installing for OpenCode"
echo ""

# Check if OpenCode config exists
OPENCODE_CONFIG="${HOME}/.config/opencode/config.toml"
if [ ! -f "$OPENCODE_CONFIG" ]; then
  OPENCODE_CONFIG="${HOME}/.opencode/config.toml"
fi

if [ ! -f "$OPENCODE_CONFIG" ]; then
  echo "Warning: OpenCode config not found."
  echo "   Expected at: ~/.config/opencode/config.toml or ~/.opencode/config.toml"
  exit 1
fi

# Copy plugin
PLUGIN_DIR="$(dirname "$OPENCODE_CONFIG")/plugins/agent-recall"
mkdir -p "$PLUGIN_DIR"
cp "$PROJECT_ROOT/opencode-plugin/index.ts" "$PLUGIN_DIR/index.ts"
echo "Plugin installed to $PLUGIN_DIR"

echo ""
echo "Agent Recall installed for OpenCode!"
echo ""
echo "Add the plugin to your OpenCode config if not already added."
echo "Start an OpenCode session to begin capturing observations."
echo "View your memory: http://localhost:37777"
