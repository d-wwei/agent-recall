# Agent Recall 优化后全景：工作原理、系统结构与功能效果

> 本文描述 29 项优化全部完成后，Agent Recall 的最终形态。
> 配套阅读：[optimization-plan.md](./optimization-plan.md)
>
> 日期：2026-04-08
> 作者：Eli + Claude

---

## 一、工作原理

把整个系统想象成一个有三种工作模式的大脑：

### 模式一：实时记忆（每次对话都在发生）

```
你跟 Claude 聊天
    │
    ├─ 你发消息 ──→ [UserPromptSubmit Hook] 记录你的意图
    │
    ├─ Claude 调工具 ──→ [PostToolUse Hook] 捕获工具输出
    │   │                     │
    │   │                     ▼
    │   │               缓冲队列（30秒窗口）
    │   │                     │
    │   │                     ▼ 窗口到期，批量发给 AI
    │   │               Claude SDK 一次性提取：
    │   │               ┌─ 标题："修复了 auth 中间件的 token 过期 bug"
    │   │               ├─ 事实：["根因是 refresh token 没有更新 expiry"]
    │   │               ├─ 概念：["authentication", "bugfix", "middleware"]
    │   │               ├─ 置信度：high（直接观察）
    │   │               └─ 偏好检测："用户说了'以后都用 httpOnly cookie'"
    │   │                     │
    │   │                     ▼
    │   │               写入 SQLite observations 表
    │   │                     │
    │   │                     ├──→ 同步到 ChromaDB（narrative 向量 + facts 向量）
    │   │                     ├──→ 偏好合成文档写入 ChromaDB
    │   │                     └──→ 提取 facts 写入知识图谱
    │   │                           "auth中间件 → 使用 → httpOnly cookie"
    │   │                           valid_from: 2026-04-08
    │   │
    │   ├─ 每 10 轮 ──→ [定期保存] 异步调 Worker 做增量摘要（用户完全无感）
    │   │
    │   └─ 上下文要压缩了 ──→ [PreCompact]
    │                           ├─ 子代理1：把当前 session 做完整摘要
    │                           └─ 子代理2：校验摘要有没有遗漏关键信息
    │
    └─ 对话结束 ──→ [SessionEnd Hook]
                      ├─ 写入 session_summary（请求/调查/学到/完成/下一步）
                      ├─ 写入 agent 日记（3句话主观感受）
                      └─ 更新活动日志
```

### 模式二：知识编译（后台定期运行）

```
Worker Service 后台定时任务（比如每天凌晨）
    │
    ├─ 编译任务
    │   │ 扫描每个项目：有没有积累够 N 条新 observations？
    │   │     │
    │   │     ▼ 有 → 调 AI 把碎片 observations 编译成结构化知识页
    │   │
    │   │   输入：15 条零散的 auth 相关 observations
    │   │   输出：一个 compiled_knowledge 页面
    │   │         ┌─────────────────────────────────────┐
    │   │         │ # Authentication 系统                │
    │   │         │                                      │
    │   │         │ ## 架构                              │
    │   │         │ - JWT + httpOnly cookie 双 token     │
    │   │         │ - refresh token 存 Redis，15分钟过期  │
    │   │         │                                      │
    │   │         │ ## 关键决策                           │
    │   │         │ - 2026-03 从 session 迁移到 JWT      │
    │   │         │ - 原因：多服务间状态同步太痛苦        │
    │   │         │                                      │
    │   │         │ ## 已解决的坑                         │
    │   │         │ - refresh token 过期 bug（04-08 修复）│
    │   │         │                                      │
    │   │         │ ```mermaid                           │
    │   │         │ graph LR                             │
    │   │         │   Client-->AuthMiddleware-->Redis    │
    │   │         │ ```                                  │
    │   │         └─────────────────────────────────────┘
    │   │
    │   └─ 同时更新项目 index（轻量目录）
    │         "auth: JWT+cookie双token, 3个决策, 1个已知坑"
    │         "deployment: Docker+Railway, 2个决策"
    │         "database: Postgres+Drizzle, 4个模式"
    │
    ├─ Lint 任务
    │   │ 矛盾检测：同一文件的两条 observations 说法不一致？→ 标记冲突
    │   │ 陈旧标记：文件改了但 observations 还说旧的？→ 标记 valid_until
    │   │ 低置信度审查：confidence=low 的条目重新检查
    │   │ 孤立降权：90天前的没人引用的 → 降低搜索权重
    │   │
    │   └─ 产出：lint 报告，仪表盘上显示告警数
    │
    └─ 冷热分离
        │ 7天内 → 完整保留
        │ 7-30天 → 权重降低
        │ 30天+ → 相似的合并为 compiled_knowledge
        │ 90天+ → 从 ChromaDB 移除向量，SQLite 保留原文归档
        │
        └─ 效果：数据库不会无限膨胀，搜索始终快速
```

### 模式三：知识调取（每次新 session 开始）

```
新 session 开始
    │
    ▼
[SessionStart Hook] 构建上下文，分四层加载：
    │
    ├─ L0（永远注入，~200 token）
    │     ┌──────────────────────────────────────────┐
    │     │ ## 身份                                   │
    │     │ 你是 Eli 的 AI 开发助手。                  │
    │     │                                           │
    │     │ ## 记忆协议                                │
    │     │ 1. 回答关于过去事实前先搜索记忆，不要猜       │
    │     │ 2. 发现矛盾信息时标记并更新                 │
    │     │ 3. 用户偏好和决策值得记录                   │
    │     └──────────────────────────────────────────┘
    │
    ├─ L1（永远注入，~400 token）
    │     ┌──────────────────────────────────────────┐
    │     │ ## 当前任务                                │
    │     │ 正在修复 auth 中间件的 rate limiting        │
    │     │ 进度：已定位问题，待写测试                  │
    │     │                                           │
    │     │ ## 项目知识目录                             │
    │     │ - auth: JWT+cookie双token, 3决策, 1坑      │
    │     │ - deploy: Docker+Railway, 2决策            │
    │     │ - database: Postgres+Drizzle, 4模式        │
    │     │ - testing: Vitest+MSW                      │
    │     │                                           │
    │     │ ## 上次未完成                               │
    │     │ 下一步：给 rate limiter 加 Redis 滑动窗口   │
    │     └──────────────────────────────────────────┘
    │
    ├─ L2（按需加载，~500-2000 token）
    │     AI 看了 L1 的 index，知道当前任务涉及 auth
    │     → 自动拉取 auth 的 compiled_knowledge 页面
    │     → 加上最近 3 天 density score 最高的 observations
    │     → 不拉取 database、testing 等不相关的内容
    │
    └─ L3（显式搜索时才触发）
          用户问 "之前那个定价讨论是怎么回事"
          → FTS5 + ChromaDB 融合搜索
          → 时间锚点解析（"之前"→ 最近 30 天）
          → 偏好合成文档也参与匹配
          → 结果融合排序，返回 top 5
          → [可选] Haiku 精排取最佳 1 条
          → 有价值的合成分析自动回写为新 observation
```

---

## 二、系统结构

### 2.1 目录结构

新增/修改的部分标 ★

```
src/
├── hooks/                          # 5 个生命周期钩子
│   ├── session-start.ts            # ★ 重构为 L0-L3 分层注入
│   ├── user-prompt-submit.ts
│   ├── post-tool-use.ts            # ★ 加计数器 + 缓冲队列
│   ├── summary.ts                  # ★ PreCompact 子代理校验
│   └── session-end.ts              # ★ 写 agent 日记 + 活动日志
│
├── services/
│   ├── sqlite/
│   │   ├── migrations/             # ★ 新增 migration
│   │   │   ├── 027-add-observation-fields.ts
│   │   │   ├── 028-compiled-knowledge.ts
│   │   │   ├── 029-knowledge-graph.ts
│   │   │   └── 030-agent-diary.ts
│   │   ├── observations/store.ts   # ★ 语义去重 + 偏好标记
│   │   ├── knowledge/              # ★ 新增
│   │   │   ├── CompiledKnowledgeStore.ts
│   │   │   ├── KnowledgeGraphStore.ts
│   │   │   └── EntityStore.ts
│   │   └── ...
│   │
│   ├── context/
│   │   ├── MemoryStack.ts          # ★ 新增：L0-L3 分层编排器
│   │   ├── IndexBuilder.ts         # ★ 新增：项目知识目录生成
│   │   ├── ObservationCompiler.ts  # 已有 density ranking
│   │   └── TokenCalculator.ts      # 已有 ROI 计算
│   │
│   ├── search/
│   │   ├── FusionRanker.ts         # ★ 新增：FTS5+ChromaDB 融合排序
│   │   ├── TemporalParser.ts       # ★ 新增：时间锚点解析
│   │   ├── PreferenceExtractor.ts  # ★ 新增：偏好检测+合成文档
│   │   ├── AssistantRetriever.ts   # ★ 新增：两遍 assistant 检索
│   │   ├── LLMReranker.ts          # ★ 新增：可选 Haiku 精排
│   │   └── QueryWriteback.ts       # ★ 新增：查询结果回写
│   │
│   ├── compilation/                # ★ 新增：知识编译层
│   │   ├── CompilationService.ts   # 定时编译 observations→知识页
│   │   ├── LintService.ts          # 矛盾检测/陈旧标记/孤立降权
│   │   ├── ConsolidationService.ts # 冷热分离+记忆整合
│   │   └── SchemaLearner.ts        # 项目自适应 schema
│   │
│   ├── ingestion/                  # ★ 新增：摄入管线
│   │   ├── BatchQueue.ts           # 缓冲队列 30秒窗口批量处理
│   │   ├── ConversationImporter.ts # 历史会话导入
│   │   └── ProjectMiner.ts         # 项目文件挖掘
│   │
│   ├── sync/
│   │   └── ChromaSync.ts           # ★ metadata 丰富化+偏好合成文档
│   │
│   ├── persona/                    # 已有
│   │   └── PersonaService.ts       # ★ 加 project_schema 类型
│   │
│   ├── recovery/                   # 已有
│   │   └── RecoveryService.ts
│   │
│   └── worker/
│       ├── WorkerService.ts        # ★ 注册新的后台定时任务
│       ├── SearchManager.ts        # ★ 接入 FusionRanker
│       └── routes/
│           ├── search.ts
│           ├── compile.ts          # ★ 新增：编译 API
│           ├── import.ts           # ★ 新增：导入 API
│           ├── mine.ts             # ★ 新增：挖掘 API
│           ├── export.ts           # ★ 新增：Markdown 导出 API
│           └── stats.ts            # ★ 新增：统计/仪表盘 API
│
├── ui/viewer/
│   ├── pages/
│   │   ├── Dashboard.tsx           # ★ 新增：记忆健康度仪表盘
│   │   ├── KnowledgeGraph.tsx      # ★ 新增：图谱可视化（D3.js）
│   │   ├── CompiledKnowledge.tsx   # ★ 新增：编译知识页浏览
│   │   ├── Search.tsx              # ★ 增强：匹配解释+高亮+溯源
│   │   ├── Timeline.tsx            # 已有
│   │   └── Export.tsx              # ★ 新增：导出管理
│   └── ...
│
├── benchmark/                      # ★ 新增
│   ├── eval-dataset.jsonl          # 50-100 个测试查询
│   ├── run-benchmark.ts            # 跑 R@5 / NDCG
│   └── results/                    # 历史评测结果
│
└── ...
```

### 2.2 数据库结构

```
~/.agent-recall/agent-recall.db

已有表（增强）：
├── observations            ★ +confidence, +valid_until, +superseded_by,
│                             +tags, +related_observations, +has_preference
├── session_summaries       不变
├── agent_profiles          ★ +project_schema 类型
├── bootstrap_state         不变
├── active_tasks            不变
├── session_archives        不变
├── sync_policies           不变
└── user_prompts            不变

新增表：
├── compiled_knowledge      编译后的知识页（项目+主题维度）
├── entities                实体节点（人/项目/工具/概念/文件）
├── facts                   时序三元组（subject→predicate→object）
├── agent_diary             agent 主观日记
└── activity_log            结构化操作日志

ChromaDB（辅助搜索层）：
├── narrative 向量
├── facts 向量
├── summary 向量
└── preference_synthetic 向量   ★ 新增：偏好合成文档
```

### 2.3 数据流全景图

```
                ┌──────────────────────────────────────────────┐
                │               用户对话                        │
                └──────────┬──────────┬──────────┬─────────────┘
                           │          │          │
                     UserPrompt  PostToolUse  SessionEnd
                           │          │          │
                           ▼          ▼          ▼
                ┌──────────────────────────────────────────────┐
                │           5 个 Lifecycle Hooks                │
                │  ┌─────────────────────────────────────────┐ │
                │  │ 缓冲队列 → 批量 AI 提取 → 偏好检测      │ │
                │  │ 定期保存（每10轮）→ 子代理校验           │ │
                │  └─────────────────────────────────────────┘ │
                └──────────┬──────────┬──────────┬─────────────┘
                           │          │          │
                           ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SQLite 主数据库                                   │
│                                                                          │
│  observations ──→ compiled_knowledge ──→ entities + facts               │
│       │                   │                      │                       │
│  session_summaries   agent_diary            activity_log                 │
│       │                   │                      │                       │
│  agent_profiles      active_tasks          session_archives              │
└────────┬─────────────────┬───────────────────────┬──────────────────────┘
         │                 │                       │
         │    ┌────────────┴────────────┐          │
         │    │    ChromaSync 批量同步   │          │
         │    └────────────┬────────────┘          │
         │                 │                       │
         │                 ▼                       │
         │    ┌──────────────────────┐             │
         │    │   ChromaDB 向量层     │             │
         │    │ narrative / facts /   │             │
         │    │ summary / preference  │             │
         │    └──────────┬───────────┘             │
         │               │                         │
         ▼               ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        检索引擎                                          │
│                                                                          │
│  FTS5 全文 ──┐                                                          │
│              ├──→ FusionRanker ──→ TemporalParser ──→ LLMReranker      │
│  ChromaDB ───┘         │                                                │
│                        │                                                 │
│  PreferenceExtractor ──┘     AssistantRetriever (两遍检索)              │
│                                                                          │
│  QueryWriteback ←── 有价值的结果自动回写                                 │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     上下文注入 (MemoryStack)                             │
│                                                                          │
│  L0（200t）  persona + RECALL_PROTOCOL                    ← 永远注入   │
│  L1（400t）  active_task + index + next_steps             ← 永远注入   │
│  L2（动态）  compiled_knowledge + recent observations     ← 按需拉取   │
│  L3（按需）  深度搜索结果                                 ← 显式触发   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
                ┌──────────────────────────────────────────────┐
                │           SessionStart 注入到 Claude          │
                └──────────────────────────────────────────────┘


后台独立运行：
┌─────────────────────────────────────────────────────────────────────────┐
│                   Worker Service 定时任务                                │
│                                                                          │
│  CompilationService ──→ N条新obs → 编译知识页 + 更新 index              │
│  LintService        ──→ 矛盾检测 / 陈旧标记 / 低置信度审查             │
│  ConsolidationService → 冷热分离 / 30天+ 合并 / 90天+ 归档向量         │
│  SchemaLearner      ──→ 检测项目模式 → 写入 project_schema             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、功能与效果

### 3.1 日常使用场景

#### 场景 A：新 session 开始

**优化前**：Claude 注入一大串最近的 observations，不管相不相关，可能塞了 2000 token 但大部分是噪音。

**优化后**：

```
Claude 看到的上下文（约 600-1000 token）：
- L0：身份 + 记忆协议（200t）
- L1：当前任务 + 项目知识目录（400t）
- L2：只有当前任务相关的编译知识页（200-400t）

效果：信噪比从 ~30% 提升到 ~90%
      token 成本降低 50%+
      Claude 不会说"我不确定之前讨论了什么"
```

#### 场景 B：搜索过去的记忆

**优化前**：语义搜索返回结果，可能漏掉关键词精确匹配的，也不处理"上周"这样的时间表达。

**优化后**：

```
你：上周关于定价策略的讨论是怎么回事？

搜索管线：
1. 解析"上周" → 2026-03-31 ~ 2026-04-07
2. FTS5 搜"定价策略" → 3 条精确命中
3. ChromaDB 语义搜 → 5 条语义相关
4. 融合排序 → 去重合并为 6 条
5. 时间加权 → 上周的结果距离减 40%
6. [可选] Haiku 精排 → 选出最佳 1 条

结果展示：
  [1] 97% 匹配 | 语义+关键词 | 2026-04-03
      "团队决定将年费从 $99 调整到 $149..."
      来源: session #4521, observation #12345
  [2] 89% 匹配 | 语义 | 2026-04-01
      ...

效果：搜索准确率从 ~85% 提升到 ~97%+
```

#### 场景 C：长时间对话

**优化前**：聊了 30 轮，中间如果 Claude Code 崩溃或被关闭，中间的记忆全丢。

**优化后**：

```
第 10 轮：Worker 后台静默做了一次增量摘要（你没感觉）
第 20 轮：又一次增量摘要
第 25 轮：上下文要压缩了
  → 子代理1 做完整摘要
  → 子代理2 校验："发现遗漏了第 18 轮的架构决策，补录"
  → 压缩继续
第 26 轮：Claude 压缩后的上下文里立刻有摘要

效果：无论在哪个节点中断，最多只丢 10 轮以内的细节
      compaction 后零信息丢失
```

#### 场景 D：跨 session 连贯性

**优化前**：新 session 开始，Claude 看到 timeline 但不记得"上次的感觉"。

**优化后**：

```
Claude 看到上次的 agent 日记：
  "上次帮 Eli 调了一整天 auth bug，最后发现是 refresh token
   没更新 expiry。Eli 对这种低级 bug 很烦躁，以后涉及 token
   的改动要特别注意写测试。"

效果：Claude 不只知道"做了什么"，还知道"什么重要"
      行为更符合用户期望
```

#### 场景 E：知识随时间成长

**优化前**：3 个月后有 500 条 observations，搜索变慢，噪音变多。

**优化后**：

```
第 1 周：15 条 observations → 直接用
第 1 月：100 条 → Lint 标记了 3 条过时的、2 条矛盾的
第 3 月：300 条 → 冷数据合并
  → 50 条 auth 相关的碎片合并为 1 个 auth 编译页
  → 30 条 deploy 相关的合并为 1 个 deploy 编译页
  → 实际活跃数据：100 条 observations + 8 个编译页
  → ChromaDB 向量：归档的已移除，只保留活跃的
第 1 年：observations 不会无限膨胀
  → 搜索始终在 <100ms
  → 编译页持续迭代更新
```

### 3.2 Viewer UI 界面

#### 仪表盘首页

```
┌─────────────────────────────────────────────────────────┐
│  Agent Recall Dashboard                                  │
├──────────────┬──────────────┬──────────────┬────────────┤
│ 总 observations │ 编译知识页  │ 实体数      │ Lint 告警  │
│     247         │    12       │    89       │   3 ⚠️     │
│ 本周 +18        │ 本周 +2     │             │            │
├──────────────┴──────────────┴──────────────┴────────────┤
│                                                          │
│  📊 类型分布          🔥 热门话题                        │
│  ████████ decision 34%   authentication (47 obs)         │
│  ██████ bugfix 28%       deployment (31 obs)             │
│  ████ feature 18%        database (28 obs)               │
│  ███ discovery 12%       testing (22 obs)                │
│  ██ refactor 8%          performance (15 obs)            │
│                                                          │
│  💰 ROI                  📅 新鲜度                       │
│  累计发现成本：2.4M tokens    7天内: ████████ 38%        │
│  累计读取成本：12K tokens     30天内: ██████ 35%          │
│  节省率：99.5%               更早: █████ 27%             │
│                                                          │
│  📡 ChromaDB: ✅ 同步正常    最后编译: 2 小时前           │
└─────────────────────────────────────────────────────────┘
```

#### 知识图谱视图

```
┌─────────────────────────────────────────────────────────┐
│  Knowledge Graph — my-project                            │
│                                                          │
│         [PostgreSQL] ─── uses ──→ [Drizzle ORM]         │
│              │                        │                  │
│           stores                   generates             │
│              │                        │                  │
│         [User Table] ←── auth ── [JWT Middleware]        │
│              │                        │                  │
│           references                protects             │
│              │                        │                  │
│         [Session] ──── replaced_by ──→ [httpOnly Cookie] │
│                                       valid_from: 03-15  │
│                                                          │
│  点击任意节点 → 查看相关 observations 和 facts            │
└─────────────────────────────────────────────────────────┘
```

#### 搜索结果

```
┌─────────────────────────────────────────────────────────┐
│  🔍 "auth middleware token bug"                          │
│                                                          │
│  [1] 97% | 语义+关键词 | 2026-04-08                     │
│  修复了 auth 中间件的 token 过期 bug                      │
│  事实: refresh token 没有更新 expiry                      │
│  匹配关键词: [auth] [middleware] [token] [bug]           │
│  来源: session #4521 → observation #12345                │
│  置信度: ● high                                          │
│                                                          │
│  [2] 91% | 语义 | 2026-03-15                             │
│  从 session-based auth 迁移到 JWT                        │
│  决策原因: 多服务间状态同步太痛苦                          │
│  来源: session #4102 → compiled_knowledge "auth"         │
│  置信度: ● high                                          │
│                                                          │
│  [3] 82% | 关键词 | 2026-02-20                           │
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

#### Markdown 导出结构

```
export/my-project/
├── index.md                    # 自动目录 + 统计
│     "# My Project Knowledge Base
│      - 247 observations, 12 knowledge pages
│      - Topics: [[auth]], [[deployment]], [[database]]..."
│
├── knowledge/
│   ├── auth.md                 # 编译知识页，含 Mermaid 图
│   ├── deployment.md
│   └── database.md
│
├── sessions/
│   ├── 2026-04-08.md           # 当天 session 汇总
│   └── 2026-04-07.md
│
├── observations/
│   ├── decisions/              # 按类型分组
│   │   ├── obs-12301.md
│   │   └── obs-12289.md
│   ├── bugfixes/
│   └── features/
│
└── graph.md                    # 实体关系图（Mermaid 源码）

→ 可直接用 Obsidian 打开，[[wiki-link]] 全部可点击
→ 可 git init 做版本控制
```

### 3.3 数字对比：优化前 vs 优化后

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| Session start token 成本 | ~1500-3000t（不可控） | ~600-1000t（分层预算） |
| 上下文信噪比 | ~30%（塞最近 N 条） | ~90%（按 index 按需拉取） |
| 搜索准确率（估计） | ~85% | ~97%+ |
| 搜索延迟 | 200-500ms | 100-300ms（metadata 预过滤） |
| 长会话信息丢失 | session end 前全部丢失 | 最多丢 10 轮细节 |
| compaction 信息丢失 | 可能丢失 | 零丢失（子代理校验） |
| 3 个月后数据量 | 300+ observations 全活跃 | ~100 活跃 + 8 编译页 + 归档 |
| 知识过时检测 | 无 | Lint 自动标记矛盾/陈旧 |
| 偏好类查询 | 基本搜不到 | 合成文档桥接，直接命中 |
| "你之前说过 X" 类查询 | 不区分 user/assistant | 两遍检索，精准定位 |
| 知识可导出性 | 锁在 SQLite 里 | Markdown + Obsidian + 幻灯片 |
| 跨 session 连贯感 | 只看 timeline | 日记 + 编译页 + 知识图谱 |

---

## 一句话总结

优化前的 Agent Recall 是**工具使用日志系统** — 忠实记录每次工具调用，按时间线回放。

优化后的 Agent Recall 是**自维护的项目知识库** — 不只记录，还编译、索引、检查、整合、遗忘，像一个真正有记忆的大脑一样工作。记录是手段，理解是目的。
