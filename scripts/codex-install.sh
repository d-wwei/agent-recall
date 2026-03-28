#!/bin/bash
# Agent Recall — Codex CLI Installation
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CODEX_CONFIG_DIR="${HOME}/.codex"
AGENT_RECALL_ROOT="${PROJECT_ROOT}/plugin"

echo "Agent Recall — Installing for Codex CLI"
echo ""

# Check if Codex config directory exists
if [ ! -d "$CODEX_CONFIG_DIR" ]; then
  echo "Creating Codex config directory..."
  mkdir -p "$CODEX_CONFIG_DIR"
fi

# Install hooks.json
echo "Installing hooks..."
HOOKS_SRC="${PROJECT_ROOT}/codex-hooks/hooks.json"
if [ -f "$HOOKS_SRC" ]; then
  sed "s|\$AGENT_RECALL_ROOT|$AGENT_RECALL_ROOT|g" "$HOOKS_SRC" > "$CODEX_CONFIG_DIR/hooks.json"
  echo "Hooks installed to $CODEX_CONFIG_DIR/hooks.json"
else
  echo "Error: codex-hooks/hooks.json not found at $HOOKS_SRC"
  exit 1
fi

# Enable hooks feature in config.toml if it exists
CONFIG_TOML="$CODEX_CONFIG_DIR/config.toml"
if [ -f "$CONFIG_TOML" ]; then
  if ! grep -q "codex_hooks" "$CONFIG_TOML"; then
    echo "" >> "$CONFIG_TOML"
    echo "[features]" >> "$CONFIG_TOML"
    echo "codex_hooks = true" >> "$CONFIG_TOML"
    echo "Enabled codex_hooks feature in config.toml"
  else
    echo "codex_hooks feature already enabled"
  fi
else
  mkdir -p "$(dirname "$CONFIG_TOML")"
  cat > "$CONFIG_TOML" << 'EOF'
[features]
codex_hooks = true
EOF
  echo "Created config.toml with codex_hooks enabled"
fi

# Write initial context to AGENTS.md
AGENTS_MD="$CODEX_CONFIG_DIR/AGENTS.md"
if [ ! -f "$AGENTS_MD" ] || ! grep -q "agent-recall-context" "$AGENTS_MD"; then
  echo "" >> "$AGENTS_MD"
  echo "<agent-recall-context>" >> "$AGENTS_MD"
  echo "Agent Recall is active. Memory context will be injected here after your first session." >> "$AGENTS_MD"
  echo "</agent-recall-context>" >> "$AGENTS_MD"
  echo "Added Agent Recall context placeholder to AGENTS.md"
fi

echo ""
echo "Agent Recall installed for Codex CLI!"
echo ""
echo "Enable hooks: Add [features] codex_hooks = true to your config.toml (if not already done)"
echo "Start a Codex session to begin capturing observations."
echo "View your memory: http://localhost:37777"
