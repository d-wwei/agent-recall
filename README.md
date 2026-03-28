# Agent Recall

**Persistent memory for AI coding agents — across tools, sessions, and projects.**

Agent Recall captures your work, remembers who you are, and picks up where you left off. It works with Claude Code, Cursor, Codex CLI, Gemini CLI, and OpenCode — all sharing the same memory.

[English](#overview) | [中文](#概述)

---

## Overview

AI coding agents forget everything between sessions. Agent Recall fixes that.

It runs a lightweight background service that:
- **Captures** tool executions automatically via lifecycle hooks
- **Compresses** observations into structured summaries using AI
- **Injects** relevant context at the start of every new session
- **Knows who it is** — agent persona with self-awareness layer
- **Knows who you are** — user profile bootstrapped via a 3-round interview
- **Knows what you were doing** — active task recovery across sessions

### Multi-Platform, One Memory

All platforms share the same SQLite database. Set up your persona in Claude Code, and Cursor sees it too. Observations from Codex appear in Gemini's context. Archives and promotions work everywhere.

| Platform | Status | Hook System | Context Injection |
|----------|--------|-------------|-------------------|
| Claude Code | ✅ Full | Plugin hooks | JSON `additionalContext` |
| Cursor | ✅ Full | Shell hooks | `.cursor/rules/` file |
| Codex CLI | ✅ Full | hooks.json | `AGENTS.md` + `additionalContext` |
| Gemini CLI | ✅ Full | hooks.json | JSON `systemMessage` |
| OpenCode | ✅ Full | TS plugin | `system.transform` hook |

## Quick Start

```bash
# Clone and build
git clone https://github.com/d-wwei/agent-recall.git
cd agent-recall && npm install && npm run build

# Install for all detected platforms
bash scripts/install.sh

# Or install for a specific platform
npm run sync-marketplace          # Claude Code
npm run cursor:install            # Cursor
bash scripts/codex-install.sh     # Codex CLI
bash scripts/gemini-install.sh    # Gemini CLI
bash scripts/opencode-install.sh  # OpenCode
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Platform Adapters (thin layer)          │
│  Claude Code · Cursor · Codex · Gemini  │
│  OpenCode · OpenClaw                     │
├─────────────────────────────────────────┤
│  Worker HTTP API (localhost:37777)       │
│  18 endpoints · Express · Bun           │
├─────────────────────────────────────────┤
│  Business Logic                          │
│  Persona · Bootstrap · Recovery          │
│  Memory Layer · Promotion · Archives     │
├─────────────────────────────────────────┤
│  SQLite + FTS5 + Chroma                  │
│  ~/.agent-recall/agent-recall.db         │
└─────────────────────────────────────────┘
```

**70-80% of the code is platform-agnostic.** Each new platform needs only a thin adapter (~80 lines).

## Key Features

### Agent Persona
Agent Recall has a self-awareness layer. After bootstrap, the agent knows its name, personality, and running environment. This persona is injected into every session.

### Bootstrap Interview
A 3-round progressive interview (bilingual EN/ZH) that captures:
1. **Core identity** — name, role, response style
2. **Working style** — recurring tasks, preferred assistant role
3. **Agent personality** — agent name, collaboration vibe, running environment

### Session Recovery
Active task tracking with cross-session continuity. When you resume, Agent Recall shows:
- Current task name, progress, and next step
- Interrupted tasks queue
- Options to continue, switch, or view context

### Memory Layering
Global vs project-scoped observations with inheritance:
- Global observations visible from all projects
- Project observations scoped to that project only
- Merge strategy: project overrides global for conflicts

### Memory Promotion
Detect and promote cross-project reusable knowledge:
- Per-project sync policy (ask / always / never)
- Promote decisions and discoveries to global scope
- Promotion history tracking

### Session Archives & Recall
Searchable session history with FTS5:
- **Temporal recall**: "What did I do yesterday?"
- **Topic recall**: "Show me work on authentication"
- Auto-archive on session completion with tags

### Viewer UI
Real-time web viewer at `http://localhost:37777` with SSE streaming, dark/light theme, and project filtering.

## API Endpoints

| Category | Endpoints |
|----------|-----------|
| **Persona** | `GET/POST /api/persona/profile`, `GET /api/persona` |
| **Bootstrap** | `GET /api/bootstrap/status`, `POST /api/bootstrap/update` |
| **Recovery** | `GET/POST /api/recovery/active-task`, `POST /api/recovery/complete-task` |
| **Search** | `GET /api/search`, `GET /api/timeline`, `GET /api/data/observations` |
| **Archives** | `GET /api/archives`, `GET /api/archives/search`, `GET /api/archives/temporal` |
| **Promotion** | `GET /api/promotion/detect`, `POST /api/promotion/sync`, `GET/POST /api/promotion/policy` |

## Configuration

Settings are stored in `~/.agent-recall/settings.json` (auto-created on first run).

Environment variables (`CLAUDE_MEM_*`) are fully backward-compatible. New `AGENT_RECALL_*` variants take priority when both are set.

## Lineage

Agent Recall is a fork of [claude-mem](https://github.com/thedotmack/claude-mem) v10.6.2 by Alex Newman ([@thedotmack](https://github.com/thedotmack)), incorporating design patterns from [claude-recall](https://github.com/d-wwei/claude-recall).

- **claude-mem** provides: hooks system, SQLite database, MCP tools, worker service, viewer UI, AI compression
- **claude-recall** provides: bootstrap interview, memory layering, agent self-awareness, session recovery, memory promotion

Licensed under [AGPL-3.0](LICENSE). See [NOTICE](NOTICE) for full attribution.

---

## 概述

AI 编程代理在会话之间会遗忘所有内容。Agent Recall 解决了这个问题。

它运行一个轻量后台服务：
- **自动捕获**工具执行（通过生命周期 hooks）
- **AI 压缩**观察结果为结构化摘要
- **注入上下文**到每个新会话的开头
- **知道自己是谁** — 具有自我意识层的 agent 人格
- **知道你是谁** — 通过 3 轮面试引导建立用户画像
- **知道你在做什么** — 跨会话的活跃任务恢复

### 多平台，一份记忆

所有平台共享同一个 SQLite 数据库。在 Claude Code 设置的人格，Cursor 也能看到。Codex 里做的工作，Gemini 的上下文里也会出现。

| 平台 | 状态 | Hook 系统 | 上下文注入 |
|------|------|----------|-----------|
| Claude Code | ✅ 完整 | 插件 hooks | JSON `additionalContext` |
| Cursor | ✅ 完整 | Shell hooks | `.cursor/rules/` 文件 |
| Codex CLI | ✅ 完整 | hooks.json | `AGENTS.md` + `additionalContext` |
| Gemini CLI | ✅ 完整 | hooks.json | JSON `systemMessage` |
| OpenCode | ✅ 完整 | TS 插件 | `system.transform` hook |

## 快速开始

```bash
# 克隆并构建
git clone https://github.com/d-wwei/agent-recall.git
cd agent-recall && npm install && npm run build

# 为所有检测到的平台安装
bash scripts/install.sh

# 或为特定平台安装
npm run sync-marketplace          # Claude Code
npm run cursor:install            # Cursor
bash scripts/codex-install.sh     # Codex CLI
bash scripts/gemini-install.sh    # Gemini CLI
bash scripts/opencode-install.sh  # OpenCode
```

## 核心特性

### Agent 人格系统
Agent Recall 有一个自我意识层。Bootstrap 完成后，agent 知道自己的名字、性格和运行环境。这个人格会注入到每个会话中。

### 引导式面试（双语 EN/ZH）
3 轮渐进式面试：
1. **核心身份** — 姓名、角色、回应风格
2. **工作方式** — 常见任务、偏好的助理角色
3. **Agent 个性** — agent 名称、协作风格、运行环境

### 会话恢复
跨会话的活跃任务跟踪。恢复时显示：
- 当前任务名称、进度、下一步
- 被中断的任务队列
- 继续/切换/查看上下文选项

### 记忆分层
全局 vs 项目作用域的观察结果，支持继承：
- 全局观察对所有项目可见
- 项目观察仅在该项目内可见
- 合并策略：项目优先于全局

### 记忆提升
检测并提升可跨项目复用的知识：
- 每项目同步策略（询问 / 总是 / 从不）
- 将决策和发现提升到全局作用域

### 会话归档与回溯
支持 FTS5 全文搜索的会话历史：
- **时间回溯**："昨天做了什么？"
- **主题回溯**："找找关于认证的工作"
- 会话完成时自动归档带标签

### 可视化界面
实时 Web 查看器 `http://localhost:37777`，支持 SSE 实时更新、深色/浅色主题、项目筛选。

## 技术栈

- **语言**: TypeScript (ES2022)
- **运行时**: Node.js 18+, Bun
- **数据库**: SQLite 3 + FTS5 + Chroma 向量
- **HTTP**: Express.js 4.18
- **AI SDK**: Claude Agent SDK + Gemini API + OpenRouter
- **构建**: esbuild
- **测试**: Bun test (1189 tests passing)

## 许可证

[AGPL-3.0](LICENSE) — 基于 claude-mem (Alex Newman) 和 claude-recall (d-wwei) 的衍生作品。详见 [NOTICE](NOTICE)。
