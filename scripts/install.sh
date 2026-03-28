#!/bin/bash
# Agent Recall — Universal Multi-Platform Installer
# Detects installed AI coding tools and offers to set up Agent Recall for each.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AGENT_RECALL_ROOT="${PROJECT_ROOT}/plugin"

echo ""
echo "  Agent Recall — Universal Installer"
echo "  Persistent memory across AI coding tools"
echo "  ========================================"
echo ""

# Detect platforms
PLATFORMS_FOUND=0

detect_platform() {
  local name="$1"
  local check="$2"
  if eval "$check" 2>/dev/null; then
    echo "  [+] $name detected"
    PLATFORMS_FOUND=$((PLATFORMS_FOUND + 1))
    return 0
  else
    echo "  [ ] $name not found"
    return 1
  fi
}

HAS_CLAUDE=false
HAS_CURSOR=false
HAS_CODEX=false
HAS_GEMINI=false
HAS_OPENCODE=false

detect_platform "Claude Code" "[ -d \"$HOME/.claude\" ]" && HAS_CLAUDE=true
detect_platform "Cursor"      "[ -d \"$HOME/.cursor\" ]" && HAS_CURSOR=true
detect_platform "Codex CLI"   "[ -d \"$HOME/.codex\" ] || command -v codex" && HAS_CODEX=true
detect_platform "Gemini CLI"  "[ -d \"$HOME/.gemini\" ] || command -v gemini" && HAS_GEMINI=true
detect_platform "OpenCode"    "[ -d \"$HOME/.config/opencode\" ] || command -v opencode" && HAS_OPENCODE=true

echo ""

if [ $PLATFORMS_FOUND -eq 0 ]; then
  echo "  No supported platforms detected."
  echo "  Supported: Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode"
  exit 0
fi

echo "  Found $PLATFORMS_FOUND platform(s). Installing..."
echo ""

# Ensure build is done
if [ ! -f "$AGENT_RECALL_ROOT/scripts/worker-service.cjs" ]; then
  echo "  Building Agent Recall first..."
  cd "$PROJECT_ROOT" && npm run build
  echo ""
fi

INSTALLED=0

# Claude Code
if [ "$HAS_CLAUDE" = true ]; then
  echo "  --- Claude Code ---"
  CLAUDE_HOOKS_DIR="$HOME/.claude/plugins/marketplaces/agent-recall"
  if [ -d "$CLAUDE_HOOKS_DIR" ]; then
    echo "  Already installed via marketplace. Skipping."
  else
    echo "  Run: npm run sync-marketplace"
    echo "  (Claude Code uses the marketplace plugin system)"
  fi
  INSTALLED=$((INSTALLED + 1))
  echo ""
fi

# Cursor
if [ "$HAS_CURSOR" = true ]; then
  echo "  --- Cursor ---"
  npm run cursor:install 2>/dev/null && echo "  Done." || echo "  Run: npm run cursor:install"
  INSTALLED=$((INSTALLED + 1))
  echo ""
fi

# Codex CLI
if [ "$HAS_CODEX" = true ]; then
  echo "  --- Codex CLI ---"
  bash "$SCRIPT_DIR/codex-install.sh"
  INSTALLED=$((INSTALLED + 1))
  echo ""
fi

# Gemini CLI
if [ "$HAS_GEMINI" = true ]; then
  echo "  --- Gemini CLI ---"
  bash "$SCRIPT_DIR/gemini-install.sh"
  INSTALLED=$((INSTALLED + 1))
  echo ""
fi

# OpenCode
if [ "$HAS_OPENCODE" = true ]; then
  echo "  --- OpenCode ---"
  bash "$SCRIPT_DIR/opencode-install.sh"
  INSTALLED=$((INSTALLED + 1))
  echo ""
fi

echo "  ========================================"
echo "  Installed for $INSTALLED platform(s)."
echo ""
echo "  All platforms share the same memory database."
echo "  Persona, observations, and archives are visible across tools."
echo ""
echo "  Viewer:  http://localhost:37777"
echo "  Data:    ~/.agent-recall/"
echo ""
