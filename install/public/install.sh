#!/bin/bash
set -euo pipefail

# Agent Recall — One-line installer
# Usage: curl -fsSL <url> | bash

RED='\033[0;31m'
NC='\033[0m'

if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is required but not found.${NC}" >&2
  echo "Install from https://nodejs.org (>= 18)" >&2
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Error: Node.js >= 18 required. Current: $(node -v)${NC}" >&2
  exit 1
fi

npx agent-recall install "$@"
