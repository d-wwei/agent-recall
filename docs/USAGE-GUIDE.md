# Agent Recall — 使用说明

> 让你的 AI 编程助手拥有持久记忆

---

## 快速开始

### 安装

Agent Recall 作为 Claude Code 插件运行。确保你有：
- Node.js 20+
- Bun（自动安装）

```bash
# 克隆仓库
git clone https://github.com/d-wwei/agent-recall.git
cd agent-recall

# 安装依赖
bun install

# 构建并部署到 Claude Code
npm run build-and-sync
```

构建完成后，下次打开 Claude Code 会自动加载 Agent Recall。

### 验证安装

```bash
# 检查 Worker 是否运行
curl http://localhost:37777/api/stats

# 检查数据库
sqlite3 ~/.agent-recall/agent-recall.db "SELECT COUNT(*) FROM observations"

# 打开 Viewer UI
open http://localhost:37777
```

---

## 日常使用

### 你不需要做任何事

Agent Recall 完全自动运行。你正常使用 Claude Code，它在后台：

1. **记录**：每次工具调用自动提取关键信息（决策、Bug 修复、发现等）
2. **存档**：每次工具调用自动保存 checkpoint（当前任务、改了什么文件、测试状态）
3. **编译**：每 5 个 session 后自动把碎片记忆整理成知识页
4. **注入**：每次新 session 开始时自动注入相关记忆

### 你唯一会注意到的变化

**SessionStart 时**，Claude 的上下文里多了一段记忆注入：

```
## Memory Protocol
1. Before answering about past facts, search memory to verify — do not guess
2. When you discover information contradicting stored memory, flag it and request an update
3. User preferences, decisions, and corrections are worth recording

> Last session checkpoint (2026-04-10T15:30:00Z):
> Task: 重构 preference API
> Tests: 3 pass, 1 fail
> Pending: routes.ts 的测试还没写
> Resume: Fix failing test in src/routes/preferences.test.ts
```

**搜文件前**，如果有相关记忆会提示：

```
> Related memory: JWT 认证中间件重构. Check /mem-search before raw file search.
```

---

## 搜索记忆

### 通过 Skill

在 Claude Code 中使用 `/mem-search` 搜索：

```
/mem-search auth 相关的决策
/mem-search 上周做了什么
/mem-search 你之前建议的数据库方案
```

### 通过 API

```bash
# 通用搜索
curl "http://localhost:37777/api/search?q=auth&project=my-project&limit=5"

# 连贯叙事回想（推荐）
curl "http://localhost:37777/api/recall?query=昨天做了什么&project=my-project"

# 时间线回想
curl "http://localhost:37777/api/recall?project=my-project&days=7"

# 主题状态查询
curl "http://localhost:37777/api/recall?query=auth模块状态&project=my-project"
```

### 搜索能力

| 搜索类型 | 示例 | 工作原理 |
|---------|------|---------|
| 关键词 | `SessionStore.ts` | FTS5 精确匹配 |
| 语义 | `怎么做认证的` | seekdb 向量相似度 |
| 时间 | `上周`、`3天前`、`last month` | 自动识别时间表达式 |
| 偏好 | `我喜欢用什么包管理器` | 偏好合成文档桥接 |
| AI 发言 | `你之前建议的`、`you mentioned` | 两遍检索（定位 session → 搜 AI 回复） |
| 混合 | `上周 auth 相关的改动` | RRF 融合排序（时间+语义+关键词） |

---

## 断点中继

### 正常退出

你用 `/exit` 或 Ctrl+C 退出 Claude Code 时：
1. AI 生成 session 摘要（完成了什么、还有什么没做、下一步建议）
2. 结构化整理为 completed / in-progress / decisions / blockers
3. 下次打开时 Claude 自动知道上下文

### 异常退出（关终端、断电）

你直接关了终端窗口时：
1. Worker 收到 SIGTERM/SIGHUP，紧急保存所有数据
2. 如果来不及保存，下次 Worker 启动时自动恢复残留数据
3. 下次打开时 Claude 看到："⚠️ 上次 session 被意外中断，数据已恢复"

**最多丢失 1 次工具调用的数据**（checkpoint 每次工具调用都会保存）。

### 手动回想

随时可以问 Claude 之前的工作：

```
你：我昨天在干嘛？
Claude：（查询 /api/recall）

昨天你做了 3 件事：
1. 修了 JWT 过期 bug（已完成）
2. 重构 preference API — 停在 routes.ts（进行中）
3. 决定连接池从 5 改到 20

建议：先完成 preference API 再补测试
```

---

## Viewer UI

打开 `http://localhost:37777` 查看：

- **Timeline**：所有 observations 按时间排列
- **Sessions**：按 session 分组查看
- **Dashboard**：记忆健康度仪表盘
  - 总 observations 数 / 本周新增
  - 按类型分布（decision / bugfix / feature / ...）
  - 热门概念 top 10
  - 数据新鲜度（热/温/冷/归档）
  - 编译知识页数量
  - Lint 告警数
  - 实体 / 事实数量

---

## 仪表盘 API

```bash
# 完整仪表盘
curl "http://localhost:37777/api/dashboard?project=my-project"

# 返回示例：
{
  "totalObservations": 142,
  "thisWeekNew": 23,
  "byType": { "decision": 15, "bugfix": 28, "feature": 35, "discovery": 40, "change": 24 },
  "topConcepts": [
    { "concept": "auth", "count": 18 },
    { "concept": "database", "count": 12 }
  ],
  "freshness": { "hot": 23, "warm": 45, "cold": 50, "archive": 24 },
  "compiledPages": 8,
  "lintWarnings": 2,
  "totalEntities": 67,
  "totalFacts": 134,
  "diaryEntries": 12
}
```

---

## 数据导出

### Markdown 导出（Obsidian 兼容）

数据自动导出到 `~/.agent-recall/readable/`：

```
~/.agent-recall/readable/
├── profile/
│   ├── user.md            # 你的档案
│   ├── style.md           # 沟通风格
│   └── agent-soul.md      # Agent 人格
├── knowledge/
│   ├── index.md           # 知识目录
│   ├── auth.md            # 编译后的认证知识
│   └── database.md        # 编译后的数据库知识
├── diary/
│   └── 2026-04-10.md      # Agent 日记
└── sessions/
    └── 2026-04-10.md      # Session 摘要
```

可以用 Obsidian 打开这个目录，用 `[[wiki-link]]` 导航。

### 多格式输出

```bash
# 项目汇报幻灯片（Marp 格式）
# 通过 OutputFormatter 的 formatAsSlides

# 时间线 HTML
# 通过 OutputFormatter 的 formatAsTimeline

# 周报 Markdown
# 通过 OutputFormatter 的 formatAsWeeklyReport
```

### 数据备份

```bash
# 数据库文件位置
ls ~/.agent-recall/agent-recall.db

# 自动备份目录
ls ~/.agent-recall/backups/
```

---

## 配置

### 设置文件

`~/.agent-recall/settings.json`（首次运行自动创建）：

```json
{
  "AGENT_RECALL_VECTOR_BACKEND": "seekdb",
  "CLAUDE_MEM_CHROMA_ENABLED": false,
  "CLAUDE_MEM_DATA_RETENTION_DAYS": 90,
  "CLAUDE_MEM_AUTO_CLEANUP_ENABLED": false,
  "CLAUDE_MEM_LOG_LEVEL": "info"
}
```

### 关键配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_RECALL_VECTOR_BACKEND` | `seekdb` | 向量搜索后端：seekdb（推荐）/ chroma / none |
| `AGENT_RECALL_COMPILATION_ENABLED` | `true` | 知识编译引擎开关 |
| `CLAUDE_MEM_DATA_RETENTION_DAYS` | `90` | 数据保留天数 |
| `CLAUDE_MEM_LOG_LEVEL` | `info` | 日志级别：debug / info / warn / error |

### 环境变量

环境变量优先于 settings.json：

```bash
export AGENT_RECALL_VECTOR_BACKEND=none  # 禁用向量搜索
export CLAUDE_MEM_LOG_LEVEL=debug        # 开启调试日志
```

---

## MCP 工具

Agent Recall 暴露 5 个 MCP 工具，可被其他 AI 工具调用：

| 工具 | 说明 |
|------|------|
| `recall_search` | 搜索记忆（FTS5 + 向量融合） |
| `recall_timeline` | 获取项目时间线 |
| `recall_compile` | 手动触发知识编译 |
| `recall_dashboard` | 获取健康度数据 |
| `recall_kg_query` | 知识图谱实体查询 |

---

## 多平台支持

Agent Recall 设计为平台无关，通过适配器支持多个 AI 编程工具：

| 平台 | 支持状态 | 适配器 |
|------|---------|--------|
| Claude Code | 完整支持 | 原生 hooks |
| Cursor | 基础支持 | cursor-hooks/ |
| Gemini CLI | 基础支持 | gemini-hooks/ |
| Codex CLI | 基础支持 | codex-hooks/ |
| OpenCode | 基础支持 | opencode-plugin/ |

---

## 故障排除

### Worker 没启动

```bash
# 手动启动
cd ~/.claude/plugins/marketplaces/agent-recall
bun plugin/scripts/worker-service.cjs start

# 检查日志
cat ~/.agent-recall/logs/worker.log
```

### 搜索没结果

```bash
# 检查是否有 observations
sqlite3 ~/.agent-recall/agent-recall.db "SELECT COUNT(*) FROM observations"

# 检查 FTS5 索引
sqlite3 ~/.agent-recall/agent-recall.db "SELECT COUNT(*) FROM observations_fts"
```

### 记忆没注入

```bash
# 检查上下文生成
curl http://localhost:37777/api/context/inject?project=your-project
```

### 重置所有数据

```bash
# 备份后删除
cp ~/.agent-recall/agent-recall.db ~/.agent-recall/agent-recall.db.bak
rm ~/.agent-recall/agent-recall.db

# 下次启动自动重建空数据库
```

---

## 开发

### 构建

```bash
npm run build              # 构建 hooks + worker + UI
npm run build-and-sync     # 构建 + 部署到插件目录 + 重启 Worker
```

### 测试

```bash
bun test                   # 全量测试（2871 个）
bun test tests/services/   # 服务层测试
bun test tests/integration/ # 端到端集成测试
npm run benchmark          # 搜索质量基准测试
```

### 项目结构

```
src/services/         # 核心业务逻辑（52 个子目录）
src/cli/handlers/     # 7 个 Hook 处理器
src/sdk/              # AI 提取（prompt + parser）
src/ui/viewer/        # React Viewer UI
tests/                # 151 个测试文件
plugin/               # 构建后的插件分发
```

详细架构见 [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md)。
