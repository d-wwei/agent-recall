# Gemini Setup — Agent Recall for Gemini CLI

Set up Agent Recall persistent memory in Gemini CLI.

## Quick Start

1. Build the project: `npm run build`
2. Install Gemini hooks: `bash scripts/gemini-install.sh`
3. Start a Gemini CLI session — observations will be captured automatically

## How It Works

- Hook scripts fire on Gemini lifecycle events (SessionStart, PostToolUse, Stop, etc.)
- The Gemini adapter handles Gemini-specific JSON format, CWD resolution, and ANSI stripping
- Context is injected via the systemMessage field in hook responses
- All data stored in the same shared database as other platforms

## Verify

After installing, start a Gemini session and use any tool. Then check:
- `GET http://localhost:37777/api/data/observations?limit=5` should show new observations
