# Installing Agent Recall

Agent Recall gives your AI coding agents persistent memory across sessions.
It works with Claude Code, Cursor, Codex CLI, Gemini CLI, and OpenCode.

## Quick Start

```bash
npx agent-recall install
```

That's it. The installer auto-detects your AI platforms and configures them.

## Verify Installation

```bash
npx agent-recall doctor
```

## Managing Platforms

```bash
npx agent-recall adapter list              # See what's installed
npx agent-recall adapter install cursor    # Add a platform
npx agent-recall adapter remove cursor     # Remove a platform
```

## For Developers

Install from source (allows editing code):

```bash
npx agent-recall install --from-source
```

## Uninstall

```bash
npx agent-recall uninstall
```

Your memory database (~/.agent-recall/) is preserved. Delete manually if desired.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npx` not found | Install Node.js >= 18 from https://nodejs.org |
| Bun install fails | Manual: `curl -fsSL https://bun.sh/install \| bash` |
| Worker won't start | `npx agent-recall doctor --fix` |
| Platform not detected | `npx agent-recall adapter install <platform>` |

---

## Agent-Executable Installation Steps

The following section is structured for AI agents to execute directly.

### Prerequisites

- Node.js >= 18 (verify: `node --version`)
- Internet access for npm package download

### Step-by-Step

1. Run: `npx agent-recall install`
2. Verify: `npx agent-recall doctor`
3. Expected output of doctor: all lines show ✓ (green checkmark)
4. If any ✗ (red cross) appears, run: `npx agent-recall doctor --fix`
5. Verify Worker is accessible: `curl -s http://localhost:37777/api/health`
6. Expected response: JSON with `{"status":"ok"}`

### Platform-Specific Manual Registration

If auto-detection fails, register manually:

- Claude Code: `npx agent-recall adapter install claude-code`
- Cursor: `npx agent-recall adapter install cursor`
- Codex CLI: `npx agent-recall adapter install codex`
- Gemini CLI: `npx agent-recall adapter install gemini`
- OpenCode: `npx agent-recall adapter install opencode`
