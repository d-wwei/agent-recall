# OpenCode Setup — Agent Recall for OpenCode

Set up Agent Recall persistent memory in OpenCode.

## Quick Start

1. Build: `npm run build`
2. Install: `bash scripts/opencode-install.sh`
3. Add the plugin to your OpenCode config

## How It Works

OpenCode uses a TypeScript plugin system:
- `tool.execute.after` → captures tool observations
- `experimental.chat.system.transform` → injects memory context into system prompt
- `event` → tracks session lifecycle

## Verify

Start an OpenCode session and use any tool. Check:
- `GET http://localhost:37777/api/data/observations?limit=5`
