# Agent Recall — One-Click Install System Design

> Date: 2026-04-10
> Status: Draft
> Author: Eli + Claude

---

## Problem

Current installation requires: clone → bun install → npm run build-and-sync. This 5+ step process blocks adoption — no one will try a memory system that takes 10 minutes to set up. There's no unified entry point: install logic is scattered across 5+ shell scripts.

## Solution

A TypeScript CLI (`npx agent-recall`) as the single entry point for installation, diagnostics, and adapter management. Two install modes: npm (default, fast) and --from-source (developers).

---

## User Experience

### Ordinary Users (90%)

```bash
npx agent-recall install
```

One command, ~30 seconds. Auto-detects installed AI agents (Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode), registers hooks for all detected platforms, starts the Worker service, and reports results:

```
✓ Bun runtime ready
✓ Agent Recall installed to ~/.agent-recall/
✓ Worker started on port 37777
✓ Platforms detected and configured:
    Claude Code  ✓ hooks registered
    Cursor       ✓ hooks registered
    Gemini CLI   ✗ not found (skip)
✓ Viewer: http://localhost:37777

Done! Your AI agents now have persistent memory.
```

### Developers / Contributors

```bash
npx agent-recall install --from-source
```

Auto: clone repo → bun install → build → sync to platforms. Same result, but with local source for development.

### Diagnostics

```bash
npx agent-recall doctor
```

Checks all critical components and reports status:

```
Agent Recall Doctor
───────────────────

Runtime
  ✓ Bun 1.2.x available
  ✓ Node.js 20.x available

Worker Service
  ✓ Running on port 37777 (PID 12345)
  ✓ Uptime: 2h 15m
  ✗ Version mismatch: running v1.0.0-alpha.1, installed v1.0.0-beta.1
    → Run: npx agent-recall install to update

Database
  ✓ SQLite: ~/.agent-recall/agent-recall.db (4.2 MB)
  ✓ SeekDB vector engine: active, 1,247 embeddings
  ○ ChromaDB fallback: disabled (default)
  ✓ Disk space: 52 GB free

Compilation Engine
  ✓ Last compile: 2026-04-10 08:30
  ✓ Knowledge pages: 12
  ○ AI merge: not configured (using text merge)

Platform Adapters
  ✓ Claude Code: hooks.json registered, 7 hooks active
  ✓ Cursor: hooks.json registered
  ✗ Codex CLI: hooks.json missing
    → Run: npx agent-recall adapter install codex

Viewer UI
  ✓ Accessible at http://localhost:37777

2 issues found. Run with --fix to attempt auto-repair.
```

### Adapter Management

```bash
npx agent-recall adapter list          # Show all platforms + install status
npx agent-recall adapter install cursor # Install hooks for specific platform
npx agent-recall adapter remove cursor  # Remove hooks for specific platform
```

### Status Check

```bash
npx agent-recall status                # Worker, DB, vector engine status
```

### Clean Uninstall

```bash
npx agent-recall uninstall             # Remove hooks, stop Worker, prompt about DB
```

### One-Line Recommendation

```
"Give your AI agents persistent memory: npx agent-recall install"
```

---

## CLI Command Structure

```
npx agent-recall <command> [options]

Commands:
  install              Install Agent Recall (npm mode by default)
    --from-source      Clone repo + local build instead of npm
    --platform <name>  Only install for specified platform (skip auto-detect)

  adapter              Manage platform adapters
    list               List all supported platforms and install status
    install <platform> Install adapter (claude-code|cursor|codex|gemini|opencode)
    remove <platform>  Remove adapter for specified platform

  doctor               Diagnostic check (extended)
    --fix              Attempt auto-fix for discovered issues

  status               Show runtime status (Worker, DB, vector engine)

  uninstall            Full uninstall (hooks, Worker, optionally DB)
```

No external CLI framework dependency (no commander/yargs). Argument parsing is hand-written — the command structure is simple enough.

---

## Install Flow

### npm Mode (default)

```
npx agent-recall install
  │
  ├─ 1. Check Node.js >= 18
  ├─ 2. Check/install Bun (reuse smart-install.js logic)
  ├─ 3. Determine install location (~/.agent-recall/)
  ├─ 4. Copy plugin/ artifacts to install location
  │     (npm package already contains compiled plugin/)
  ├─ 5. Run bun install in install location (tree-sitter deps)
  ├─ 6. Detect platforms (Claude Code, Cursor, Codex, Gemini, OpenCode)
  ├─ 7. For each detected platform → register hooks
  │     (reuse src/cli/adapters/ logic for platform-specific registration)
  ├─ 8. Start Worker service
  ├─ 9. Verify health (GET localhost:37777/api/health)
  └─ 10. Print summary
```

### --from-source Mode

```
npx agent-recall install --from-source
  │
  ├─ 1. Check Node.js >= 18
  ├─ 2. Check/install Bun
  ├─ 3. git clone https://github.com/d-wwei/agent-recall.git ~/.agent-recall/source
  ├─ 4. cd ~/.agent-recall/source && bun install
  ├─ 5. npm run build
  ├─ 6-10. Same as npm mode (detect platforms, register hooks, start Worker)
  └─ Symlink: plugin/ → ~/.agent-recall/source/plugin/
```

### curl Wrapper (simplified)

`install.sh` becomes a thin wrapper:

```bash
#!/bin/bash
# One-line install for Agent Recall
# Usage: curl -fsSL <url> | bash

if ! command -v node &>/dev/null; then
  echo "Node.js >= 18 required. Install from https://nodejs.org/"
  exit 1
fi

npx agent-recall install "$@"
```

No more dependency on Vercel-hosted `installer.js`.

---

## Platform Detection

Reuses existing logic from `scripts/install.sh`, ported to TypeScript:

| Platform | Detection Method |
|----------|-----------------|
| Claude Code | `which claude` or `~/.claude/` exists |
| Cursor | `which cursor` or `~/.cursor/` exists |
| Codex CLI | `which codex` |
| Gemini CLI | `which gemini` |
| OpenCode | `which opencode` or `~/.config/opencode/` exists |

Each platform has a registration function that:
1. Copies the platform-specific hooks.json to the correct location
2. Substitutes `AGENT_RECALL_ROOT` with the actual install path
3. Verifies registration succeeded

Existing `src/cli/adapters/` (6 adapters) handle the runtime hook normalization. The installer handles the one-time registration.

---

## Doctor Checks (Extended)

| Category | Check | Auto-fixable |
|----------|-------|-------------|
| **Runtime** | Bun available + version | Yes (install Bun) |
| **Runtime** | Node.js available + version | No (manual install) |
| **Worker** | Process running + port listening | Yes (start Worker) |
| **Worker** | Version match (running vs installed) | Yes (restart Worker) |
| **Database** | SQLite file exists + readable | No |
| **Database** | SeekDB vector engine status | Yes (reinitialize) |
| **Database** | ChromaDB fallback status | Info only |
| **Database** | Disk space sufficient (> 100 MB) | No |
| **Compilation** | Last compile time + staleness | Info only |
| **Compilation** | Knowledge page count | Info only |
| **Compilation** | AI merge configured | Info only |
| **Adapters** | Each platform: hooks registered + valid | Yes (re-register) |
| **Viewer** | HTTP accessible | Yes (restart Worker) |
| **Config** | API key configured | Info only |

---

## INSTALL.md Structure

Dual-audience document:

```markdown
# Installing Agent Recall

## Quick Start (Human-Readable)
Brief explanation of what Agent Recall does, then:
  npx agent-recall install

## Troubleshooting
Common issues and fixes, points to `npx agent-recall doctor`

## Uninstall
  npx agent-recall uninstall

---

## Agent-Executable Installation Steps
(Structured, unambiguous steps an AI agent can follow directly)

### Prerequisites
- Node.js >= 18
- Internet access for npm

### Step-by-Step
1. Run: npx agent-recall install
2. Verify: npx agent-recall doctor
3. Expected output: [exact format]

### Platform-Specific Notes
Per-platform instructions for manual registration if auto-detect fails
```

---

## Technical Implementation

### New Files

| File | Purpose |
|------|---------|
| `src/cli/installer/index.ts` | CLI entry point, argument parser, command dispatch |
| `src/cli/installer/commands/install.ts` | Install orchestration (npm + from-source modes) |
| `src/cli/installer/commands/doctor.ts` | Diagnostic checks + auto-fix |
| `src/cli/installer/commands/adapter.ts` | Platform adapter list/install/remove |
| `src/cli/installer/commands/status.ts` | Runtime status display |
| `src/cli/installer/commands/uninstall.ts` | Clean removal |
| `src/cli/installer/platform-detect.ts` | Platform detection (ported from shell) |
| `src/cli/installer/hook-register.ts` | Hook registration per platform (ported from shell) |
| `bin/agent-recall.cjs` | Compiled CLI binary (esbuild output) |
| `INSTALL.md` | Dual-audience install documentation |

### Modified Files

| File | Change |
|------|--------|
| `package.json` | Add `"bin": { "agent-recall": "./bin/agent-recall.cjs" }` |
| `scripts/build-hooks.js` | Add CLI entry point to esbuild config |
| `install/public/install.sh` | Simplify to `npx agent-recall install` wrapper |

### Retired Files (after transition)

These scripts are replaced by the CLI but kept during transition period:

- `scripts/install.sh` → `npx agent-recall install`
- `scripts/codex-install.sh` → `npx agent-recall adapter install codex`
- `scripts/gemini-install.sh` → `npx agent-recall adapter install gemini`
- `scripts/opencode-install.sh` → `npx agent-recall adapter install opencode`

---

## Costs

| Dimension | Estimate |
|-----------|----------|
| New code | ~800-1200 lines TypeScript |
| Existing code changes | package.json + esbuild config |
| Runtime cost | Zero — CLI is install orchestration only, no API calls |
| Maintenance | Lower than current (one entry point vs 5+ scattered scripts) |
| Publish dependency | One `npm publish` needed for npx to work |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| npm package name `agent-recall` taken | Low | Verify with `npm view agent-recall`. Fallback: `@agent-recall/cli` |
| Windows compatibility | Medium | Use Node.js built-in APIs (fs, child_process), avoid shell commands. Label Windows as beta initially |
| Breaking existing install flow | Low | New CLI is additive — `npm run build-and-sync` continues to work. Old scripts retired only after CLI is stable |
| npm publish leaks source | Low | `"files": ["plugin", "bin"]` restricts published content. Verify with `npm pack --dry-run` |
| Bun auto-install fails (corporate networks) | Medium | Doctor command detects and provides manual install instructions |
| npx caching stale version | Low | `npx agent-recall@latest install` as documented fallback |

---

## Success Criteria

1. `npx agent-recall install` completes in < 60 seconds on a fresh machine (with Node.js)
2. `npx agent-recall doctor` reports all-green on a healthy installation
3. Zero manual steps for Claude Code + Cursor (the two most common platforms)
4. INSTALL.md is actionable by both humans and AI agents
5. Existing `npm run build-and-sync` workflow unaffected

---

## Out of Scope

- Auto-update mechanism (future: `npx agent-recall update`)
- GUI installer
- Package manager alternatives (brew, apt, scoop)
- CI/CD integration hooks
