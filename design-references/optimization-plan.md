# Agent Recall 全面优化方案

> 综合 MemPalace + Karpathy LLM Wiki 双源深度代码分析
>
> 日期：2026-04-08
> 作者：Eli + Claude

---

## 背景

本方案基于对两个外部项目的深度代码阅读与对比分析：

- **MemPalace**（github.com/milla-jovovich/mempalace）— 15.4k star 的 AI 记忆系统，Python 实现，核心优势在检索工程（LongMemEval 96.6% → 99.4%）和分层记忆栈（L0-L3）
- **Karpathy LLM Wiki** — 知识编译系统，核心理念是 "Compilation Over Retrieval"，把原始素材编译成结构化 wiki 而非简单存储+检索

两个项目从不同角度指向相同结论：**知识应该被编译和维护，而不仅仅是被记录和检索。**

本方案将两者的最佳实践整合为 Agent Recall 的统一升级路线。

---

## 架构总览

优化后的 Agent Recall 架构分为七层：

```
┌─────────────────────────────────────────────────────────────┐
│  第七层：表现层                                               │
│  图谱可视化 / 仪表盘 / Markdown导出 / 多输出格式 / 搜索解释    │
├─────────────────────────────────────────────────────────────┤
│  第六层：评测与质量                                            │
│  检索 benchmark / 活动日志标准化                               │
├─────────────────────────────────────────────────────────────┤
│  第五层：数据摄入                                              │
│  非阻塞定期保存 / PreCompact子代理 / 会话导入 / 文件挖掘       │
├─────────────────────────────────────────────────────────────┤
│  第四层：上下文注入                                            │
│  RECALL_PROTOCOL / 项目自适应Schema / 唤醒摘要精简             │
├─────────────────────────────────────────────────────────────┤
│  第三层：记忆管理                                              │
│  分层记忆栈 L0-L3 / 知识Lint / 冷热分离与整合                  │
├─────────────────────────────────────────────────────────────┤
│  第二层：检索引擎                                              │
│  自适应融合排序 / 时间锚点 / 偏好合成 / 两遍检索 / LLM精排     │
├─────────────────────────────────────────────────────────────┤
│  第一层：存储与数据模型                                        │
│  知识编译表 / 知识图谱 / observations增强 / ChromaDB丰富化     │
├─────────────────────────────────────────────────────────────┤
│  第零层：记忆系统归属与迁移                                     │
│  双系统共存 / 增量Bootstrap / 旧数据迁移 / 并发模型             │
└─────────────────────────────────────────────────────────────┘
```

---

## 第零层：记忆系统归属与迁移（架构决策）

### 0.1 双记忆系统共存 + Agent Recall 优先

**背景**：当前存在三套记忆系统并行：

1. **Claude Code auto memory**（`~/.claude/memory/*.md`）— 原生的 user/feedback/project/reference 类型记忆
2. **Claude Recall 的 .assistant/ 体系**（`.assistant/USER.md, STYLE.md, WORKFLOW.md, MEMORY.md...`）— 旧系统，bootstrap 面谈建立用户档案
3. **Agent Recall**（`agent_profiles` 表）— 从 Claude Recall fork 合并而来，已包含 bootstrap + persona 全部能力

三套系统记录同样的用户身份、风格偏好、工作方式，导致 token 浪费和信息不一致风险。

**决策**：Agent Recall 作为**主记忆系统**，auto memory 作为**辅助记忆系统**，两者共存但 Agent Recall 优先。`.assistant/` 体系退役，通过一键迁移将旧数据导入 Agent Recall。

**核心原则**：**不对抗原生系统，而是从中汲取**。auto memory 是 Anthropic 原生功能，Agent Recall 作为 plugin 无法也不应试图禁用它。正确做法是让 Agent Recall 主动同步 auto memory 中的有价值信息，保证两套系统一致。

**优化后的记忆归属**：

| 记忆类型 | 主归属 | 辅助归属 | 存储位置 |
|---------|--------|---------|---------|
| 用户身份/角色 | Agent Recall (bootstrap) | auto memory 可能重复记录 | agent_profiles |
| 沟通风格 | Agent Recall (bootstrap) | auto memory 可能重复记录 | agent_profiles |
| 工作方式偏好 | Agent Recall (bootstrap + 日常积累) | auto memory 可能重复记录 | agent_profiles |
| Agent 人格 | Agent Recall (bootstrap) | — | agent_profiles |
| 日常反馈纠正 | Agent Recall (PostToolUse) | auto memory feedback 类 | observations |
| 技术发现/决策 | Agent Recall (PostToolUse) | — | observations |
| 编译后的项目知识 | Agent Recall (编译任务) | — | compiled_knowledge |
| 实体关系 | Agent Recall (AI 提取) | — | entities + facts |
| 项目技术指令 | CLAUDE.md（手动维护，不动） | — | 文件 |
| 项目引用/指针 | auto memory（reference 类） | — | `~/.claude/memory/` |
| 项目级上下文 | auto memory（project 类） | — | `~/.claude/memory/` |
| ~~.assistant/ 体系~~ | ~~退役，通过 0.3 迁移~~ | — | — |

**Auto Memory 同步机制**：

```
SessionStart 时：
1. 扫描 ~/.claude/memory/*.md
2. 解析 frontmatter（type: user/feedback/project/reference）
3. 对 user/feedback 类型：
   a. 计算 content hash，对比上次同步记录
   b. 新增或变更的条目 → 导入 Agent Recall（user→agent_profiles, feedback→observations）
   c. 记录同步时间戳到 sync_state 表，避免重复导入
4. 对 project/reference 类型：不导入，保留在 auto memory 原位
```

**上下文注入优先级**（当两套系统有同一信息时）：

```
Agent Recall agent_profiles > auto memory user 类
Agent Recall observations > auto memory feedback 类
auto memory project/reference 类照常注入（Agent Recall 不管这些）
```

**具体做法**：

- Agent Recall 的 bootstrap skill 替代 `.assistant/` 的初始化流程
- PersonaService 的 `agent_soul/user/style/workflow` 替代 `.assistant/USER.md, STYLE.md, WORKFLOW.md`
- SessionStart 时从 auto memory 增量同步（见上方机制），保证 Agent Recall 拥有最全的用户信息
- 上下文注入时 Agent Recall 数据优先，auto memory 中已被 Agent Recall 覆盖的信息不重复注入
- auto memory 继续自然运行，Agent Recall 只读取不干预

**改动**：中（新增同步逻辑 + 清理 .assistant/ 依赖）
**收益**：两套系统和平共存，Agent Recall 始终拥有最全数据，用户无需手动同步

---

### 0.2 增量 Bootstrap（渐进式完善）

**问题**：当前 bootstrap 是一次性的 3 轮面谈，完成后标记 `status: completed` 就不再触发。但用户的角色、偏好、工作方式会随时间变化，bootstrap 收集的信息逐渐过时。

**方案**：bootstrap 从"一次性采集"升级为"渐进式完善"：

1. **完整性检测**：定义 agent_profiles 的"完整性 schema"（哪些字段必填、哪些推荐填），每次 SessionStart 检查当前完整度
2. **缺口补充**：如果检测到空缺（如从未记录过技术栈偏好），在合适时机（如用户空闲时）轻量提问补充，而非启动完整 bootstrap 流程
3. **过期刷新**：agent_profiles 中超过 90 天未更新的条目，标记为 `stale`，SessionStart 时提示用户确认是否仍然有效
4. **触发条件**：
   - `bootstrap_status: never` → 完整 3 轮面谈
   - `bootstrap_status: completed` + 完整度 < 80% → 针对性补问 1-2 个问题
   - `bootstrap_status: completed` + 有 stale 条目 → 确认式更新（"你的角色还是 X 吗？"）
   - `bootstrap_status: completed` + 完整度 ≥ 80% + 无 stale → 跳过

**改动**：中 | **收益**：用户档案永远保持最新，不需要"重新 bootstrap"

---

### 0.3 .assistant/ 旧数据一键迁移

**问题**：已使用 Claude Recall `.assistant/` 体系的用户，迁移到 Agent Recall 时不应丢失已积累的数据。

**方案**：提供一键迁移命令（通过 bootstrap skill 或 Worker API 触发）：

```
迁移映射：
.assistant/USER.md      → agent_profiles type=user
.assistant/STYLE.md     → agent_profiles type=style
.assistant/WORKFLOW.md  → agent_profiles type=workflow
.assistant/MEMORY.md    → observations（按条目拆分）
.assistant/memory/projects/*.md → observations（按项目标记）
.assistant/memory/daily/*.md   → 跳过（短期数据，不值得迁移）
.assistant/runtime/last-session.md → session_summaries（最近一条）
```

**执行流程**：

1. 检测 `.assistant/` 目录是否存在
2. 如果存在，提示用户："检测到旧版记忆数据，是否导入到 Agent Recall？"
3. 用户确认后，按映射读取并写入 agent_profiles / observations
4. 迁移完成后，将 `.assistant/` 重命名为 `.assistant.migrated/`（归档而非删除）
5. 记录迁移时间戳，防止重复迁移

**自动触发**：首次 bootstrap 时，如果检测到 `.assistant/` 存在，自动提议迁移（可跳过）。

**改动**：中 | **收益**：老用户零损失迁移，降低切换阻力

---

### 0.4 Auto Memory 条目导入

**问题**：用户可能已在 auto memory 中积累了有价值的 user/feedback 记忆。首次使用 Agent Recall 时，这些数据应该被导入。

**方案**：

1. 首次 bootstrap 时（或用户手动触发），扫描 `~/.claude/memory/*.md`
2. 解析每个文件的 frontmatter：
   - `type: user` → 提取内容，写入 agent_profiles（去重检查）
   - `type: feedback` → 提取内容，写入 observations（type=feedback, confidence=high）
   - `type: project` / `type: reference` → 跳过（保留在 auto memory）
3. 后续通过 0.1 的同步机制自动增量同步新条目

**与 0.1 的区别**：0.4 是**一次性全量导入**（首次使用时），0.1 是**持续增量同步**（每次 SessionStart）。

**改动**：小 | **收益**：auto memory 中已有的用户知识不浪费

---

### 0.5 多会话并发模型

**来源**：Git Worktree "隔离 → 工作 → 合并" 模式的启发

**问题**：用户可能同时开多个 Claude Code session，每个 session 都在读写 Agent Recall 的 SQLite 数据库。当前没有并发控制，可能出现：

- 多个 session 同时写 observations → 数据竞争
- 编译任务运行时新 session 写入 → 编译结果过时
- 多个 session 同时触发编译 → 资源浪费

**方案**：借鉴 Worktree 的"隔离工作空间 + 最终合并"思路，但适配 DB 场景：

**第一层：SQLite WAL 模式（基础并发）**

```sql
PRAGMA journal_mode = WAL;    -- 允许并发读，单写不阻塞读
PRAGMA busy_timeout = 5000;   -- 写冲突时等待 5 秒而非立即失败
```

WAL 模式天然支持"多读单写"，已覆盖大多数日常场景（多个 session 同时读记忆，偶尔一个在写）。

**第二层：Session-Scoped Write Buffer（写隔离）**

```
每个 session 的 observations 先写入缓冲表：
  observation_buffer（session_id, payload, created_at）

SessionEnd 时一次性 flush 到主表：
  INSERT INTO observations SELECT ... FROM observation_buffer WHERE session_id = ?
  DELETE FROM observation_buffer WHERE session_id = ?
```

类比 Worktree：每个 session 在自己的"分支"上工作，SessionEnd 时"合并"到主线。好处：
- 短暂的写入不会阻塞其他 session 的读取
- 如果 session 异常退出，缓冲数据不会污染主表
- 可以在 flush 前做去重检查

**第三层：Advisory Lock（后台任务互斥）**

```
编译任务、Lint 任务、冷热分离等后台操作使用文件锁：
  ~/.agent-recall/locks/compilation.lock（PID + mtime）

锁获取逻辑：
  1. 尝试获取锁
  2. 成功 → 执行任务
  3. 失败 → 检查持有者 PID 是否存活
     - 存活 → 跳过本次（等下次 SessionEnd 重试）
     - 死亡 → 清理过期锁，重新获取
```

**第四层：Worker Service 串行化**

Worker Service（port 37777）是所有 AI 处理的唯一入口，天然单实例。多个 session 的请求通过 HTTP 到达 Worker，Worker 内部队列串行处理。这已经是现有架构的隐含保障，只需明确文档化。

**Session 生命周期时序图**：

```
Session A                    Session B                   Worker Service
─────────                    ─────────                   ──────────────
SessionStart                      │                           │
├─ 读 agent_profiles              │                           │
├─ 读 compiled_knowledge          │                           │
├─ 同步 auto memory               │                           │
│                             SessionStart                    │
│  工具调用                    ├─ 读 agent_profiles            │
│  ├─ 写入 buffer_A              │  (WAL: 不阻塞)             │
│                              │  工具调用                     │
│  工具调用                    │  ├─ 写入 buffer_B            │
│  ├─ 写入 buffer_A              │                           │
│                              │                             │
SessionEnd                     │                             │
├─ flush buffer_A → 主表       │                             │
├─ 触发编译检查 ──────────────────────────────────────────→ 获取锁 → 编译
│                              │                             │
│                           SessionEnd                       │
│                           ├─ flush buffer_B → 主表         │
│                           ├─ 触发编译检查 ──────────→ 锁被持有 → 跳过
```

**改动**：中 | **收益**：多 session 安全并发，后台任务不冲突

---

## 第一层：存储与数据模型

### 1.1 知识编译表（新增）

**来源**：LLM Wiki "Compilation Over Retrieval" + MemPalace 记忆整合缺失

**问题**：原始 observations 太碎，100 条里只能塞 20 条进上下文。

**方案**：

```sql
CREATE TABLE compiled_knowledge (
  id INTEGER PRIMARY KEY,
  project TEXT NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,              -- 编译后的 Markdown
  source_observation_ids TEXT,        -- JSON: 来源 observation IDs
  confidence TEXT DEFAULT 'high',     -- high / medium / low
  protected BOOLEAN DEFAULT 0,        -- 受保护，lint 不自动修改
  version INTEGER DEFAULT 1,
  compiled_at TEXT,
  valid_until TEXT,
  superseded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

- 上下文注入时优先读编译页，而非每次重新拼接原始 observations

**Compiled Truth 分类策略（来自 ex-brain）**：

编译时先让 LLM 判断每条 fact 的信息类型，再按类型选择不同处理策略：

| 信息类型 | 示例 | 处理方式 | 生命周期 |
|---------|------|---------|---------|
| **状态类** | 技术栈、当前架构、活跃分支 | 直接**替换**旧值，旧值归入 History 区 | 会"过期" |
| **事实类** | 项目创建时间、仓库地址、license | **追加**，不删旧的 | 不会过期 |
| **事件类** | 版本发布、重大 bug、架构迁移决策 | 记入 Status + **时间线** | 永久 |

编译产出结构：项目架构认知（Status）、不变事实（Facts）、关键事件时间线（Events）、常见模式、文件关系

**触发机制（借鉴 Claude Code Dream 的 5 道门控）**：

编译不使用简单的定时器（如"每天凌晨"），而是采用事件驱动 + 多级门控：

| 门控 | 条件 | 目的 |
|------|------|------|
| Feature gate | 功能开启 | 总开关 |
| Time gate | 距上次编译 ≥ 24 小时 | 防止过频 |
| Scan throttle | 距上次扫描 ≥ 10 分钟 | 防止重复检查 |
| Session gate | 上次编译后有 ≥ 5 个新 session | 确保有足够新信息 |
| Lock | 获取进程锁（PID + mtime） | 防止并发 |

触发时机：每个 SessionEnd 时检查门控，fire-and-forget。条件满足就跑，不满足就跳过。比定时器更智能——用户高强度使用时当天就编译，不使用时不白跑。

**执行 4 阶段（借鉴 Dream 的 Orient → Gather → Consolidate → Prune）**：

1. **Orient** — 读现有 compiled_knowledge 索引，了解当前知识结构
2. **Gather** — 扫描上次编译后的新 observations，按 project + topic 分组
3. **Consolidate** — 合并新 observations 到现有知识页，去重，纠正过时信息，生成 Mermaid 图
4. **Prune** — 更新项目 index，控制知识页体积，清理矛盾

**隔离执行**：编译任务在 Worker Service 中 fork 独立执行，不影响主对话。

**失败回滚**：编译失败或被中止时，回滚锁时间戳让下次重试。用户可通过 Viewer UI 手动中止。

**UI 反馈**：Viewer UI 仪表盘显示编译状态 "Compiling..." → "Compiled N knowledge pages"。

**隐私传播防护**：编译过程会合并多条 observations 为一个知识页。如果某条 observation 来自包含 `<private>` 标签的 session，编译时必须跳过该 observation，防止隐私内容通过编译间接泄露到知识页中。compiled_knowledge 也支持 `privacy_scope` 字段（'global' | 'project'），控制知识页的可见范围。

**改动**：大 | **收益**：根本性改进上下文质量

---

### 1.2 知识图谱表（新增）

**来源**：MemPalace temporal knowledge graph + LLM Wiki 交叉引用

**方案**：

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'unknown',        -- person/project/tool/concept/file
  properties TEXT DEFAULT '{}',
  first_seen_at TEXT,
  last_seen_at TEXT
);

CREATE TABLE facts (
  id TEXT PRIMARY KEY,
  subject TEXT REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object TEXT REFERENCES entities(id),
  valid_from TEXT,
  valid_to TEXT,                       -- 过期不删除，标记结束
  confidence REAL DEFAULT 1.0,
  source_observation_id INTEGER REFERENCES observations(id),
  source_ref TEXT,                     -- 文件名:行号
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

- AI 提取 observation 时顺便提取结构化 facts
- 支持时序查询："这个事实在 X 日期是否仍然有效"
- 支持实体关系遍历："这个项目用了什么技术栈"

**实体消解策略**：同名实体可能在不同项目中指向不同事物（如 "config" 在 A 项目是文件名，在 B 项目是概念）。消解规则：

1. 实体 ID = `{project}:{type}:{normalized_name}`（项目级隔离，避免跨项目混淆）
2. 全局实体（如 "React"、"TypeScript"）用 `_global:{type}:{name}` 前缀
3. AI 提取时同时输出 `is_global: boolean` 标记，全局实体自动归并
4. 可疑冲突（同名但不同 type）标记 `needs_review`，Lint 阶段提示用户确认

**改动**：大 | **收益**：结构化知识查询、时序事实追踪、实体关系可视化

---

### 1.3 Observations 表增强

**来源**：MemPalace 时序有效性 + LLM Wiki confidence/tags/交叉引用

**方案**：新增字段分两批 migration，与使用这些字段的系统同步上线。

**第一批（Phase 1 — 立即可用，AI 提取时直接写入）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `confidence` | TEXT | 'high'（直接观察）/ 'medium'（推测）/ 'low'（间接） |
| `tags` | TEXT (JSON) | 自由标签 |
| `has_preference` | BOOLEAN | 是否包含偏好表达 |
| `event_date` | TEXT | 事件发生时间，区别于 created_at 记录时间（来自 ex-brain 时间线自动抽取） |
| `last_referenced_at` | TEXT | 最近一次被搜索/引用的时间，用于信息衰减计算（来自 ex-brain） |

前三个字段在 AI 提取时直接写入。`event_date` 由 AI 从文本中抽取语义时间（"上周做的决策" → 具体日期）。`last_referenced_at` 每次搜索命中时自动更新。`confidence` 用于搜索排序加权，`tags` 用于 ChromaDB metadata 丰富化（1.4），`has_preference` 用于偏好合成文档（2.3）。

**第二批（Phase 3 — 依赖编译系统就绪）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `valid_until` | TEXT | 过期时间戳，过期不删除 |
| `superseded_by` | INTEGER | 被哪条新 observation 取代 |
| `related_observations` | TEXT (JSON) | 交叉引用其他 observation IDs |

这三个字段由编译任务和 Lint 机制维护（如 Lint 检测到旧 observation 被新信息取代时设置 `superseded_by`），Phase 1 阶段加了也没有系统写入它们。

**第二批还包括新增关联表（来自 ex-brain 自动实体关联）**：

```sql
CREATE TABLE observation_links (
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES observations(id),
  target_id INTEGER REFERENCES observations(id),
  relation TEXT NOT NULL,  -- 'relates_to', 'supersedes', 'contradicts', 'builds_on'
  auto_detected BOOLEAN DEFAULT TRUE,
  created_at TEXT DEFAULT (datetime('now'))
);
```

当新 observation 涉及与旧 observation 相同的文件或概念时，自动建立 `relates_to`。当明确更新了旧信息时标记 `supersedes`。ContextBuilder 可沿关联链拉取更多上下文。

**改动**：中 | **收益**：observations 从扁平记录变成结构化知识单元

---

### 1.4 ChromaDB Metadata 丰富化

**来源**：MemPalace wing+room 过滤（R@10 从 60.9% → 94.8%）

**方案**：同步到 ChromaDB 时增加 metadata 字段

```typescript
metadata: {
  sqlite_id: number,
  doc_type: 'narrative' | 'facts' | 'summary' | 'preference_synthetic',
  topic: string,              // 从 concepts 派生的主话题
  observation_type: string,   // decision/bugfix/feature/...
  confidence: string,         // high/medium/low
  created_at_epoch: number,
}
```

搜索时先按 metadata 缩小范围再做向量匹配。

**改动**：小 | **收益**：搜索精度大幅提升

---

### 1.5 幂等去重

**来源**：MemPalace `check_duplicate(threshold=0.9)` + ex-brain 幂等操作

**方案**：两层去重机制：

**第一层 — PostToolUse 级别（来自 ex-brain）**：同一 session 中，相同文件 + 相同工具 + 5 分钟窗口内，检查最近 observation 的 narrative 相似度。如果 > 0.9 则合并（保留最新，追加新增 facts），而非重复插入。

**第二层 — 写入时语义去重（来自 MemPalace）**：写入 observation 前对 narrative 做 ChromaDB query，similarity >= 0.92 则合并而非新增。

**改动**：小 | **收益**：防止近似 observations 积累，减少数据库膨胀

---

## 第二层：检索引擎

### 2.1 FTS5 + ChromaDB 自适应融合排序

**来源**：MemPalace 关键词融合 + LLM Wiki Dataview 结构化查询

**问题**：agent-recall 已有双通道但结果分开返回，没有融合。

**方案**：

```typescript
// 自适应融合排序 — 根据查询类型动态调整权重
function getWeights(query: string): { chroma: number, fts5: number } {
  if (isExactMatch(query))    return { chroma: 0.3, fts5: 0.7 };  // 精确关键词查询偏向 FTS5
  if (isSemanticQuery(query)) return { chroma: 0.8, fts5: 0.2 };  // 模糊语义查询偏向 ChromaDB
  return { chroma: 0.55, fts5: 0.45 };                            // 默认略偏语义
}

// 查询类型检测
isExactMatch: 包含引号、文件名、函数名、错误代码等精确 pattern
isSemanticQuery: 包含"相关的"、"类似"、"关于"、"how to" 等模糊表达

final_score = w.chroma * chroma_similarity + w.fts5 * normalize(fts5_rank)
```

FTS5 的 BM25 rank 天然比 MemPalace 的朴素关键词计数强。同时支持结构化过滤：

```
"auth 相关的决策" → WHERE type='decision' AND concepts LIKE '%auth%' + 语义搜索
```

初始权重基于启发式规则，后续通过 benchmark（6.1）数据校准。

**多维加权（来自 ex-brain）**：融合排序不只考虑语义+关键词，还加入 type 权重和信息衰减：

```typescript
// 在融合排序基础上叠加多维加权
const typeWeight = TYPE_WEIGHTS[hit.type] || 0.5;
// decision=1.0, discovery=0.8, bugfix=0.7, feature=0.6, change=0.5, refactor=0.4

const daysSinceReferenced = daysBetween(hit.last_referenced_at || hit.created_at, now);
const staleness = Math.min(1.0, daysSinceReferenced / 180);
const decayFactor = 1 - staleness * 0.3;  // 最多降 30%

final_score = (w.chroma * chroma_similarity + w.fts5 * fts5_rank) * typeWeight * decayFactor
```

信息衰减基于 `last_referenced_at`（1.3 新增字段）：长期未被搜索/引用的 observations 自动降权，但不删除。

**改动**：小 | **收益**：搜索质量直接提升

---

### 2.2 时间锚点解析

**来源**：MemPalace hybrid_v2（时间表达 → 日期 → 40% 距离衰减）

**方案**：搜索查询预处理时用正则检测时间表达（"上周"、"三天前"、"last month"），算出目标日期范围，给 `created_at_epoch` 匹配的结果加权。

```typescript
// 时间衰减
temporal_boost = max(0.0, 0.40 * (1.0 - days_diff / window_days))
fused_dist = fused_dist * (1.0 - temporal_boost)
```

**改动**：小 | **收益**：精准回答时间类查询

---

### 2.3 偏好提取 + 合成文档

**来源**：MemPalace hybrid_v3（16 个正则 + synthetic docs）

**方案**：

1. observation 处理时检测偏好表达（"I prefer X"、"always use X"、"我习惯用X"、"不要用Y"）
2. 标记 `has_preference: true`
3. 生成合成文档同步到 ChromaDB："用户偏好：{偏好内容}"

当用户后来问"我之前说过用什么风格"时，合成文档直接匹配上。

**改动**：中 | **收益**：偏好查询词汇鸿沟桥接

---

### 2.4 两遍 Assistant 检索

**来源**：MemPalace 的 user-only → full-text 两遍策略

**方案**：当查询含"你之前说过"、"你建议的"、"you mentioned"时触发：

1. 第一遍：搜 observations 定位 session
2. 第二遍：对命中 sessions 的 transcript 原文搜 assistant 发言

**改动**：中 | **收益**：大幅提升"AI 说了什么"类查询准确率

---

### 2.5 可选 LLM 精排

**来源**：MemPalace Haiku rerank（$0.001/query，99.4% R@5）

**方案**：SearchManager 加可选 `llmRerank` 开关。对 top 10-20 构造精排 prompt 发给 Haiku，只返回 1 个编号。失败时 graceful fallback。

**改动**：小 | **收益**：极致搜索精度

---

### 2.6 查询结果回写（带防反馈循环）

**来源**：LLM Wiki "有价值的查询结果应自动存回知识库"

**方案**：当 mem-search 产出有价值的合成分析时，存为新 observation（type = synthesis）。后续查询可复用。

**防反馈循环机制**：回写的合成结果如果和普通 observations 同等参与搜索排序，会产生自我强化——被回写的内容在后续搜索中获得更高权重，错误信息越来越难被淘汰。

防护措施：
1. **降权**：`type=synthesis` 的 observations 在融合排序时乘以 0.7x 系数（低于原始观察）
2. **用户门控**：回写不自动执行，而是在搜索结果末尾提示 "是否保存此分析供后续复用？"，用户确认后才回写
3. **有效期**：synthesis 类型默认 `valid_until = 创建时间 + 90天`，过期后自动降级（不参与常规搜索，仅深度搜索可见）
4. **不可编译**：synthesis 类型不参与知识编译（1.1），防止合成结果被二次编译放大

**改动**：小 | **收益**：知识复利，同时避免信息回音室效应

---

## 第三层：记忆管理

### 3.1 显式分层记忆栈 L0-L3

**来源**：MemPalace 四层设计 + LLM Wiki Index 目录

**问题**：当前 context injection 是整体编排，没有显式 token 预算分层。

**方案**：

总注入预算 `TOTAL_BUDGET` 默认 3000 tokens，可在 settings.json 中配置（范围 1500-8000），也可按项目覆盖。

| 层 | 内容 | 预算分配 | 策略 |
|---|---|---|---|
| L0 | persona + 行为指令（RECALL_PROTOCOL） | TOTAL 的 8%（~240t） | 永远注入，不可压缩 |
| L1 | active task + 项目 index + 上次 next_steps | TOTAL 的 15%（~450t） | 永远注入，index 是关键创新 |
| L2 | compiled knowledge 精华 + recent observations | TOTAL 的 60%（~1800t） | 按 index 按需拉取 |
| L3 | 深度搜索结果 | 剩余 17% + 按需扩展 | 显式搜索时触发 |

百分比制的优势：用户调高 `TOTAL_BUDGET` 时各层等比扩展，不需要分别调整。简单项目可设 1500t 省 token，复杂微服务项目可设 6000t 保证覆盖。

**项目级覆盖**：agent_profiles 中 `type=project_config` 可存储该项目的 `token_budget` 和各层权重覆盖，优先于全局 settings。

**L1 的 index** 是核心设计：每个项目维护轻量目录（概念清单 + 一句话摘要），AI 先读 index 再决定需要什么详细内容。比 MemPalace 的"按 importance 取 top 15"更智能。

**改动**：中 | **收益**：token 成本可控、按需加载、信噪比最高

---

### 3.2 知识 Lint 机制

**来源**：LLM Wiki Lint 操作 + MemPalace 时序有效性 + Claude Code Dream 的执行模式

**方案**：

| 检查项 | 说明 |
|--------|------|
| 矛盾检测 | 同一文件的不同 observations 声明矛盾事实 → 标记冲突 |
| 陈旧标记 | 文件被大幅修改后标记相关旧 observations 的 `valid_until` |
| 孤立降权 | 古老且无后续引用的 observations 降低搜索权重 |
| 低置信度审查 | 优先检查 confidence=low 的条目 |
| 受保护跳过 | `protected=1` 的编译页面不自动修改 |

**执行模式**：Lint 与编译（1.1）共享同一套 Dream 式基础设施——门控、锁、fork 隔离、失败回滚。Lint 作为编译 4 阶段中 Prune 阶段的扩展执行，不需要单独的触发链路。

**改动**：中 | **收益**：防止记忆腐化

---

### 3.3 记忆冷热分离与整合

**来源**：MemPalace 缺失（被诟病无遗忘机制）+ LLM Wiki 编译理念 + Claude Code Dream 的增量处理模式

**方案**：

| 层级 | 时间 | 策略 |
|------|------|------|
| 热数据 | 7天内 | 完整保留，ChromaDB 向量保持 |
| 温数据 | 7-30天 | 保留原文，搜索权重降低 |
| 冷数据 | 30天+ | 同 topic 相似 observations 合并为 compiled_knowledge |
| 归档 | 90天+ | 从 ChromaDB 移除向量，SQLite 原文保留 |

冷数据合并 = LLM Wiki 的"编译"过程：AI 把碎片 observations 编译成结构化知识页。

**执行模式**：冷热分离同样复用编译任务的 Dream 式基础设施。在编译的 Consolidate 阶段，同时检查数据年龄，对满足条件的冷数据执行合并，对满足条件的归档数据执行向量清理。增量处理——每次只处理上次以来新进入冷/归档阈值的数据。

**改动**：大 | **收益**：长期可扩展，数据不会无限膨胀

---

## 第四层：上下文注入策略

### 4.1 行为指令注入（RECALL_PROTOCOL）

**来源**：MemPalace PALACE_PROTOCOL

**方案**：嵌入 L0 层，每次 session start 注入：

```markdown
## 记忆协议
1. 回答关于过去事实前，先搜索记忆验证，不要猜
2. 发现与记忆矛盾的信息时，标记并请求更新
3. 用户的偏好和决策值得记录
```

**改动**：极小 | **收益**：减少 AI 凭空回答

---

### 4.2 项目自适应 Schema

**来源**：LLM Wiki "Schema as Living Document"

**方案**：agent_profiles 表增加 `project_schema` 类型。AI 自动学习项目模式（如频繁涉及 migration → 上下文强调"注意 migration 文件"）。

**改动**：小 | **收益**：上下文从通用变成项目定制化

---

### 4.3 唤醒摘要精简

**来源**：MemPalace L1 严格控制 3200 字符

**方案**：session start 注入时，observations 只展示 title + 第一个 fact，严格限制总量。完整内容降级为 L2 按需加载。

**改动**：中 | **收益**：启动更快，token 更省

---

## 第五层：数据摄入

### 5.1 非阻塞定期保存

**来源**：MemPalace Save Hook 每 15 轮（改为非阻塞）

**方案**：PostToolUse hook 加计数器，每 N 轮（如 10 轮）异步调 Worker API `/api/incremental-save`。Worker 在后台做增量摘要，主对话不中断。

**改动**：中 | **收益**：长会话记忆安全

---

### 5.2 PreCompact 子代理保存 + 校验

**来源**：MemPalace PreCompact Hook（永远 block）+ 子代理改造

**方案**：

1. 派生保存子代理：完整摘要当前 session
2. 派生校验子代理：读回 summary 对比 observations 检查遗漏
3. 遗漏则补写补充 observation
4. 两个子代理完成后允许 compaction

**成本说明**：每次 compaction 触发 2 次 Haiku 调用（保存 + 校验），约 $0.002/次。日均 compaction 2-3 次 = $0.004-0.006/天，可接受。

**优化**：若 session 的 observation 数 < 3，跳过校验子代理（信息量太少不值得验证）。

**改动**：中 | **收益**：compaction 后记忆零丢失

---

### 5.3 批量摄入

**来源**：LLM Wiki 的 batch ingest 概念

**问题**：当前 agent-recall 逐条处理 observation，每次工具调用单独做一次 AI 提取。短时间内连续 5 次工具调用 = 5 次独立 AI 调用，每次只看到碎片上下文。

**方案**：在 Worker Service 中加缓冲队列。使用自适应窗口而非固定时间：

- 收到第一条工具调用结果后，启动 **10 秒初始窗口**
- 窗口内每收到一条新结果，**延长 5 秒**（最大延长到 45 秒）
- 窗口关闭后，批次内所有结果一次性发给 AI 提取

自适应窗口比固定 30 秒更合理——快速连续操作（读文件+改文件+跑测试）自然聚合为一批，而两组不相关的操作之间的间隔天然超过窗口，不会被错误合并。

AI 能看到完整上下文（"先读了 A 文件，再改了 B 文件，最后跑了测试"），产出的 observation 质量更高。

**改动**：中 | **收益**：减少 AI 调用次数、提高提取质量

---

### 5.4 会话导入

**来源**：MemPalace convo_miner（Claude/ChatGPT/Slack 导入）

**方案**：新增 `/api/import` endpoint，接受 JSONL 格式会话记录，走 AI 提取流程。

**改动**：中 | **收益**：历史会话补录

---

### 5.5 项目文件挖掘

**来源**：MemPalace miner.py（项目目录扫描）

**方案**：新增 `/api/mine` endpoint，扫描 README/docs/CHANGELOG 等高价值文件，提取项目背景知识。

**改动**：中 | **收益**：项目上下文更完整

---

## 第六层：评测与质量

### 6.1 检索质量 Benchmark

**来源**：MemPalace 500 题 LongMemEval 评测方法论

**方案**：建立内部评测集（50-100 个查询→期望命中对），每次修改搜索逻辑后跑一遍算 R@5 和 NDCG。结果存为 JSONL 追踪历史。

**改动**：中 | **收益**：数据驱动优化

---

### 6.2 活动日志标准化

**来源**：LLM Wiki log.md 严格格式时间线

**方案**：规范活动日志格式：`[YYYY-MM-DD] operation | title — one-line-summary`。操作类型：session / ingest / query / lint / bootstrap。SessionStart 时读最近 N 条快速恢复上下文。

**改动**：小 | **收益**：轻量快速扫描

---

## 第七层：表现层

### 7.1 Agent 日记

**来源**：MemPalace diary_write/diary_read

**方案**：SessionEnd 时 AI 写 3-5 句主观日记，存入 `agent_diary` 表。比 session_summary 更主观——不只"做了什么"，还有"注意到什么"、"觉得什么重要"。日记可作为 L1 的一部分注入。

**改动**：小 | **收益**：跨 session 连贯性

---

### 7.2 知识图谱可视化

**来源**：MemPalace palace graph + LLM Wiki 视觉元素

**方案**：

- Viewer UI 新增图谱视图：concepts 为节点，共现关系为边
- 编译知识页时自动生成 Mermaid 图（文件依赖、架构图、决策树）
- Viewer UI 支持 Mermaid 渲染

**改动**：中 | **收益**：知识关联可见

---

### 7.3 记忆健康度仪表盘

**来源**：MemPalace status 命令

**方案**：Viewer UI 首页仪表盘显示：

- 总 observations / 本周新增
- 按 type 分布（decision/bugfix/feature/...）
- 按 concept 的 top 10 热门话题
- discovery_tokens 的累计 ROI 曲线
- 记忆新鲜度分布（7天内 / 30天内 / 更早）
- ChromaDB 同步状态
- Lint 告警数

**改动**：中 | **收益**：状态一目了然

---

### 7.4 Markdown 双向同步 + Obsidian 兼容

**来源**：LLM Wiki 全栈 Markdown 设计 + 数据库存储的可读性劣势补偿

**问题**：数据库存储虽然对程序友好（可搜索、可查询、可编译），但对人类不友好 — 用户无法像编辑 `.assistant/USER.md` 那样直接看和改自己的记忆。SQLite 不可 git 版本控制、不可跨工具浏览、调试困难。

**方案**：SQLite 为主存储，自动生成人类可读的 Markdown 副本，支持双向同步。

```
~/.agent-recall/readable/（人类可读副本，自动生成+双向同步）
├── profile/
│   ├── user.md              ← agent_profiles type=user
│   ├── style.md             ← agent_profiles type=style
│   ├── workflow.md          ← agent_profiles type=workflow
│   └── agent-soul.md        ← agent_profiles type=agent_soul
├── knowledge/
│   ├── index.md             ← 自动目录 + 统计
│   ├── auth.md              ← compiled_knowledge
│   ├── deployment.md
│   └── database.md
├── sessions/
│   ├── 2026-04-08.md        ← session_summaries 按日期
│   └── 2026-04-07.md
├── observations/
│   ├── decisions/           ← 按类型分组
│   ├── bugfixes/
│   └── features/
├── diary/
│   └── 2026-04-08.md        ← agent_diary
└── graph.md                  ← 实体关系图（Mermaid）
```

**双向同步机制**：

- **DB → 文件**：每次 SessionEnd 或编译任务完成后，自动重新生成 Markdown 副本
- **文件 → DB**：SessionStart 时通过 **content hash** 检测 Markdown 文件是否被用户手动编辑过（hash 比 mtime 更可靠——部分编辑器保存时会触发多次 mtime 变化，或 mtime 精度不够）
- 支持 `[[wiki-link]]` 交叉引用，可直接用 Obsidian 打开
- 可 `git init` 做版本控制
- 存储开销极小（纯文本，典型使用量 < 1MB）

**同步状态追踪**：

```sql
CREATE TABLE markdown_sync (
  file_path TEXT PRIMARY KEY,
  last_db_hash TEXT,        -- 上次从 DB 生成时的 content hash
  last_file_hash TEXT,      -- 上次检测到的文件 content hash
  last_sync_at TEXT
);
```

**冲突解决**：

SessionStart 时检测到文件 hash 与 `last_file_hash` 不同（用户编辑过），同时 DB 数据也有更新（来自其他 session 或编译任务）：

1. 保留两个版本：将 DB 版写为 `*.db-version.md`，用户编辑版保持原名
2. 下次 SessionStart 时提示用户："检测到 profile/user.md 被手动编辑，但数据库也有新变更。保留哪个版本？（用户编辑 / 数据库 / 合并）"
3. 用户选择后清理多余文件，更新 sync 状态
4. 如果无冲突（只有一方变更），自动同步，无需用户介入

**效果**：程序用数据库（结构化查询、向量搜索、编译整合），人用 Markdown（随时看、随时改、可 git、可 Obsidian）。两个世界的优势兼得。

**改动**：中 | **收益**：消除数据库存储的可读性劣势，降低锁定效应

---

### 7.5 多输出格式

**来源**：LLM Wiki Marp 幻灯片 + 图表

**方案**：

- mem-search 支持输出为幻灯片（Marp，适合项目汇报）
- 支持导出为 timeline HTML（进度可视化）
- 支持生成项目周报 Markdown

**改动**：中 | **收益**：知识库直接服务于日常输出

---

### 7.6 搜索结果解释 + 来源溯源

**来源**：MemPalace similarity 展示 + LLM Wiki 脚注系统

**方案**：

- 搜索结果显示匹配分数 + 匹配类型（语义/关键词/混合）+ 关键词高亮
- facts 字段增加可选的 `source_ref`（文件:行号）
- Viewer UI 从 fact 可跳转到原始 observation

**改动**：小 | **收益**：透明度和可信度

---

## 成本估算

**背景**：优化后的 Agent Recall 在多个环节引入 LLM 调用（编译、Lint、偏好合成、精排、子代理校验等）。需要预估成本确保可控。

以下基于 **中等活跃用户**（日均 5 个 session，每 session 产出 10 条 observations）估算，LLM 调用使用 Haiku（$0.25/1M input, $1.25/1M output）：

| 功能 | 触发频率 | 单次调用 | 月成本估算 | 默认状态 |
|------|---------|---------|-----------|---------|
| Observation AI 提取 | 每批次 1 次（5.3 合并后约 10 次/天） | ~2k tokens | $0.15/月 | 默认开启 |
| 知识编译（1.1） | 约每 2-3 天 1 次 | ~10k tokens（4 阶段） | $0.10/月 | 默认开启 |
| 知识 Lint（3.2） | 随编译执行 | ~3k tokens | $0.03/月 | 默认开启 |
| 偏好合成文档（2.3） | 每次检测到偏好 | ~0.5k tokens | $0.02/月 | 默认开启 |
| PreCompact 子代理（5.2） | 每次 compaction 2 调用 | ~2k tokens | $0.06/月 | 默认开启 |
| LLM 精排（2.5） | 每次搜索 1 调用 | ~1k tokens | $0.15/月（按 20 次搜索/月） | **默认关闭** |
| 会话导入（5.4） | 用户手动触发 | 按量 | 按使用量 | 手动触发 |

**月总成本预估**：$0.36/月（默认开启功能） ～ $0.51/月（全部开启）

**成本控制手段**：
- settings.json 中每个 LLM 功能可独立开关
- `monthly_llm_budget` 上限设置（默认 $2.00），达到后仅保留核心提取功能
- Viewer UI 仪表盘显示当月 LLM 调用次数和估算成本

---

## 实施路线图

### Phase 1 — 基础加固 + 基线建立（2-3周）

| 编号 | 优化点 | 改动量 |
|------|--------|--------|
| 6.1 | **检索质量 Benchmark（先于一切搜索优化）** | 中 |
| 0.1 | 双记忆系统共存 + auto memory 同步机制 | 中 |
| 0.3 | .assistant/ 旧数据一键迁移 | 中 |
| 0.4 | Auto memory 条目导入 | 小 |
| 0.5 | 多会话并发模型（WAL + write buffer + 锁） | 中 |
| 4.1 | 行为指令注入 RECALL_PROTOCOL | 极小 |
| 2.1 | FTS5 + ChromaDB 自适应融合排序 | 小 |
| 1.4 | ChromaDB metadata 丰富化 | 小 |
| 5.1 | 非阻塞定期保存 | 中 |
| 1.3a | observations 表第一批字段（confidence, tags, has_preference） | 小 |

**目标**：建立搜索基线 benchmark → 确立记忆系统归属 → 完成迁移通道 → 低成本高回报的搜索和安全改进。Benchmark 前置确保后续所有搜索优化有数据衡量。

### Phase 2 — 智能检索（2-3周）

| 编号 | 优化点 | 改动量 |
|------|--------|--------|
| 0.2 | 增量 Bootstrap（渐进式完善） | 中 |
| 3.1 | 显式分层记忆栈 L0-L3（百分比预算） + 项目 index | 中 |
| 2.2 | 时间锚点解析 | 小 |
| 2.3 | 偏好提取 + 合成文档 | 中 |
| 4.3 | 唤醒摘要精简 | 中 |

**目标**：改变上下文注入策略，从"推最近 N 条"变成"按需拉取相关内容"。用 benchmark 验证每项改进的实际效果。

### Phase 3 — 知识编译（3-4周）

| 编号 | 优化点 | 改动量 |
|------|--------|--------|
| 1.1 | compiled_knowledge 表 + 编译任务（含隐私传播防护） | 大 |
| 1.3b | observations 表第二批字段（valid_until, superseded_by, related） | 小 |
| 3.2 | 知识 Lint 机制 | 中 |
| 3.3 | 冷热分离与整合 | 大 |
| 5.2 | PreCompact 子代理校验 | 中 |
| 4.2 | 项目自适应 Schema | 小 |

**目标**：核心升级——从"记录+检索"升级为"记录+编译+分层注入"。1.3b 与编译系统同步上线，确保字段有系统写入。

### Phase 4 — 知识图谱（2-3周）

| 编号 | 优化点 | 改动量 |
|------|--------|--------|
| 1.2 | entities + facts 表（含实体消解策略） | 大 |
| 2.4 | 两遍 assistant 检索 | 中 |
| 2.6 | 查询结果回写（带防反馈循环） | 小 |
| 7.1 | Agent 日记 | 小 |

**目标**：结构化知识能力，支持实体查询和事实追踪。

### Phase 5 — 表现层（2-3周）

| 编号 | 优化点 | 改动量 |
|------|--------|--------|
| 7.2 | 知识图谱可视化 | 中 |
| 7.3 | 记忆健康度仪表盘（含成本追踪） | 中 |
| 7.4 | Markdown 双向同步 + Obsidian（content hash + 冲突解决） | 中 |
| 7.6 | 搜索结果解释 | 小 |
| 7.5 | 多输出格式 | 中 |

**目标**：护城河特性，差异化用户体验。

### Phase X — 按需补充

| 编号 | 优化点 | 改动量 | 来源 |
|------|--------|--------|------|
| 2.5 | 可选 LLM 精排 | 小 | MemPalace |
| 5.3 | 批量摄入（自适应窗口缓冲队列） | 中 | LLM Wiki |
| 5.4 | 会话导入 | 中 | MemPalace |
| 5.5 | 项目文件挖掘 | 中 | MemPalace |
| 6.2 | 活动日志标准化 | 小 | LLM Wiki |
| 1.5 | 幂等去重（PostToolUse级+语义级） | 小 | MemPalace + ex-brain |
| 8.1 | MCP Server 原生集成（见下方详述） | 中 | ex-brain |
| 8.2 | seekdb 统一数据库架构（见下方详述） | 高 | ex-brain |

---

### 8.1 MCP Server 原生集成（Phase X）

**来源**：ex-brain 的 MCP Server 模式

**问题**：当前 Agent Recall 通过 hooks + HTTP API + Skills 间接与 Claude 交互。链路较长。

**方案**：将 Worker Service 的核心 API 包装为 MCP Server，Claude 可直接通过 MCP 工具读写记忆：

```json
{
  "mcpServers": {
    "agent-recall": {
      "command": "node",
      "args": ["plugin/scripts/mcp-server.js"]
    }
  }
}
```

MCP 工具清单：
- `recall_search` — 搜索记忆（FTS5 + ChromaDB 融合）
- `recall_timeline` — 查看时间线
- `recall_compile` — 手动触发编译
- `recall_lint` — 手动触发健康检查
- `recall_kg_query` — 知识图谱查询

比当前 Skill → HTTP → Worker 的链路更短、更原生。

**改动**：中 | **收益**：更原生的 Claude 集成，延迟更低

---

### 8.2 seekdb 统一数据库架构（长期方向）

**来源**：ex-brain 使用的 seekdb（OceanBase 的 AI 原生混合搜索数据库）

**问题**：当前 SQLite + ChromaDB 双系统需要 ChromaSync 维护同步，有一致性风险。

**方案**（长期评估）：如果 seekdb JS SDK 成熟度达标，可考虑从 SQLite + Chroma 迁移到 seekdb 单一引擎：
- 嵌入式部署：一个 DB 文件即可运行
- 原生混合检索：向量搜索 + 全文搜索 + 标量过滤在一个引擎中
- 内置 AI 函数：AI_EMBED、AI_COMPLETE、AI_RERANK 直接在 SQL 中调用
- 消除 ChromaSync 复杂度

**短期替代方案**：SQLite FTS5 + sqlite-vec（纯 SQLite 方案，已有成熟生态），同样可消除双系统。

**seekdb 当前状态**：v1.2，2.5k stars，还较新。建议持续观察后再决策。

**改动**：高（数据库迁移）| **收益**：消除双系统同步，架构简化 | **时间线**：v2 架构方向

---

## 核心设计原则

贯穿整个方案的几个原则：

1. **共存互补**：Agent Recall 作为主记忆系统，与 Claude Code auto memory 和平共存，主动同步而非对抗
2. **编译优于检索**：知识应该被定期编译成结构化页面，而非每次从原始记录拼接
3. **分层加载**：永远注入的 L0/L1 要极度精简，详细内容按需拉取
4. **时序优先**：事实带有效期，过期标记而非删除，支持时间切片查询
5. **自适应融合**：FTS5 精确匹配 + ChromaDB 语义匹配的融合排序，权重根据查询类型动态调整
6. **非阻塞异步**：所有保存和编译操作通过 Worker 异步执行，不打断用户对话
7. **Dream 式门控**：后台任务不用简单定时器，而是事件驱动 + 多级门控（时间+数量+锁），确保该跑时跑、不该跑时不浪费资源
8. **基线先行**：每次搜索优化前先建立 benchmark 基线，用数据而非感觉衡量效果
9. **可导出**：数据不锁死在系统里，支持 Markdown/Obsidian 双向同步
10. **隐私安全**：编译和合成过程尊重隐私标签，防止信息通过编译间接泄露

---

## 附录：参考资料

- MemPalace 本地代码：`/Users/admin/Documents/AI/mempalace/`
- MemPalace 架构图：`design-references/mempalace-arch.png`
- Agent Recall 架构图：`design-references/agent-recall-arch.png`
- MemPalace 混合检索详细设计：`/Users/admin/Documents/AI/mempalace/benchmarks/HYBRID_MODE.md`
- MemPalace Benchmark 结果：`/Users/admin/Documents/AI/mempalace/benchmarks/BENCHMARKS.md`
- Karpathy LLM Wiki + ex-brain 完整分析：`design-references/karpathy-llm-wiki-analysis.md`
- ex-brain npm 包：https://www.npmjs.com/package/ex-brain
- seekdb：https://github.com/oceanbase/seekdb
- Claude Code Dream 分析：来自 Octo Agent 项目 claude-code 源码分析
