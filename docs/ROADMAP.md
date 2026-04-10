# Agent Recall — Future Roadmap

> 本文档记录已完成优化之后的后续迭代方向，供后续开发参考。
>
> 日期：2026-04-09
> 当前版本：v1.0.0-beta.1（Phase 1-5 + Phase X 全部落地）

---

## 当前状态速览

**已完成**：37/38 项优化，+28,038 行代码，77 个新文件，2511 tests (0 fail)

**架构**：
- 存储：SQLite (bun:sqlite) + ChromaDB (可选) 双系统
- 检索：FTS5 + ChromaDB 自适应融合排序 + 时间锚点 + 偏好合成
- 编译：CompilationEngine (5-gate + 4-stage) + KnowledgeLint + HotColdManager
- 上下文：L0-L3 分层 Token 预算 (TokenBudgetManager)
- 知识图谱：entities + facts + 时序查询
- 表现层：Dashboard API + Markdown 导出 + 多输出格式 + MCP 工具

**唯一未实施项**：8.2 seekdb 统一数据库（长期观察方向）

---

## 迭代方向一览

### Tier 1：高优先级（直接提升用户体验）

#### 1.0 一键安装 + 多平台适配器分发

**现状**：安装需要 clone → bun install → npm run build-and-sync，门槛太高。各平台 hook 适配器（Cursor/Codex/Gemini/OpenCode）格式不统一，没有统一的安装流程。用户无法把一个链接发给 Agent 就完成安装。

**目标体验**：

```bash
# 主程序安装（一句话）
curl -fsSL https://raw.githubusercontent.com/d-wwei/agent-recall/main/install.sh | bash

# 或通过 npx
npx agent-recall install

# 给其他 Agent 装适配器（一句话）
npx agent-recall adapter install cursor
npx agent-recall adapter install codex
npx agent-recall adapter install gemini
```

**需要做的事**：

| 组件 | 说明 |
|------|------|
| `install.sh` | curl 一键安装脚本：检测环境 → 安装 Bun → clone → build → 注册 Claude Code hooks |
| `npx agent-recall` CLI | npm 全局命令，支持 `install` / `adapter install <platform>` / `adapter list` / `status` |
| 适配器标准化 | 每个平台一个独立目录：`adapters/{cursor,codex,gemini,opencode}/`，统一结构（hooks.json + install.sh + README） |
| 安装检测 | `npx agent-recall doctor` — 检查主程序、Worker、各平台适配器、DB 状态 |
| Agent 可读安装指南 | `INSTALL.md` — 写给 AI Agent 看的安装文档（结构化、无歧义，Agent 可以直接按步骤执行） |

**发给 Agent 的一句话**：
```
"安装 Agent Recall 记忆系统：npx agent-recall install && npx agent-recall adapter install cursor"
```

**改动量**：中 | **价值**：极高 — 直接降低获客门槛，让"给 Agent 发一句话就能装好"成为现实

---

#### 1.01 Agent 权限管理（IBAC）

**现状**：所有连接到 Worker 的 Agent 都能读写所有数据，零权限控制。

**目标**：基于 Agent 身份的访问控制，支持：
- 某些 Agent 可以访问所有记忆（admin）
- 某些 Agent 只能访问指定项目的记忆（project-scoped）
- 某些 Agent 只读不写（read-only）

**设计**：

```
Agent 请求 → Worker HTTP API → AuthMiddleware（检查 X-Agent-Id header）
                                    │
                                    ├─ 查 agent_access_policies 表
                                    ├─ 匹配权限级别: admin / project-rw / project-ro / global-only
                                    └─ 过滤查询范围 or 返回 403
```

**权限级别**：

| 级别 | 读 | 写 | 编译 | 范围 | 适合 |
|------|---|---|------|------|------|
| admin | 全部 | 全部 | 是 | 所有项目+全局 | 主力 Agent |
| project-rw | 指定项目 | 指定项目 | 否 | 项目级 | 项目专属 Agent |
| project-ro | 指定项目 | 否 | 否 | 项目级 | 审查 Agent |
| global-only | 全局 | 否 | 否 | 全局 | 通用助手 |

**需要新增**：`agent_access_policies` 表、`AuthMiddleware`、`AgentRegistry`、CLI 管理命令、hook 适配器传 agent ID

**改动量**：大 | **价值**：高 — 安全基础，多 Agent 协作的前提

---

#### 1.1 AI 驱动的知识编译升级

**现状**：`ConsolidateStage.ts` 使用文本拼接 + 去重（MVP），没有语义理解能力。

**升级方向**：
- 调用 LLM (Haiku) 将碎片 observations 合成为连贯叙述
- 自动识别矛盾信息并标记冲突
- 自动检测信息被取代（如"架构从 A 迁移到 B"应取代旧的"架构是 A"）
- 生成 Mermaid 图（文件依赖、架构图、决策树）
- 按 Compiled Truth 分类策略处理：状态类替换旧值，事实类追加，事件类记入时间线

**预估**：中等改动。核心修改 `ConsolidateStage.ts`，复用现有 SDKAgent/GeminiAgent 调用模式。

**成本**：约 $0.10/月（每 2-3 天编译一次，每次 ~10k tokens）

---

#### 1.2 Viewer UI 增强

**现状**：Viewer (`http://localhost:37777`) 是基础的观察时间线 + 搜索，没有利用后端新能力。

**需要新增的 UI 功能**：

| 功能 | 后端支持 | UI 工作量 |
|------|---------|----------|
| 记忆健康度仪表盘 | `GET /api/dashboard` 已就绪 | 中（React 组件 + 图表库） |
| 知识图谱可视化 | entities + facts 表已有数据 | 大（图渲染库如 D3/Cytoscape） |
| Mermaid 图渲染 | 编译引擎可生成 Mermaid | 小（集成 mermaid.js） |
| 搜索结果解释 | SearchExplainer 已就绪 | 小（显示分数、匹配类型、关键词高亮） |
| 编译状态指示器 | CompilationEngine 有状态 | 小（"Compiling..." 进度条） |
| LLM 成本追踪面板 | 需要新增计数器 | 中 |
| Lint 告警面板 | KnowledgeLint 已就绪 | 小 |

**建议**：先做仪表盘（最容易，后端已 ready），再做搜索解释（小改动大提升），最后做图谱（最复杂）。

---

#### 1.3 KnowledgeLint ↔ Dashboard 集成

**现状**：`DashboardService.ts` 中 `lintWarnings = 0` 有一个 TODO，KnowledgeLint 已实现但未接入 Dashboard。

**修复**：在 Dashboard 查询中调用 `KnowledgeLint.run(project)` 并返回 `warnings.length`。

**预估**：极小改动（< 20 行）。

---

### Tier 2：中优先级（架构质量提升）

#### 2.1 统一数据库方案评估

**现状**：SQLite + ChromaDB 双系统，依赖 ChromaSync 维护同步一致性。

**两个候选方案**：

| 方案 | 说明 | 成熟度 | 优势 | 劣势 |
|------|------|--------|------|------|
| **sqlite-vec** | SQLite 原生向量扩展 | 高（活跃生态） | 消除双系统、零依赖 | 向量搜索性能不如专业 DB |
| **seekdb** | OceanBase AI 原生混合搜索 | 低（v1.2, 2.5k stars） | 原生混合检索+内置 AI 函数 | 太新，JS SDK 不成熟 |

**建议**：
- 短期（3-6 个月）：评估 sqlite-vec 作为 ChromaDB 的替代品，可以消除 ChromaSync 复杂度
- 长期（6-12 个月）：持续观察 seekdb 生态成熟度
- 评估标准：嵌入式部署能力、JS/TS SDK 质量、社区活跃度、基准测试性能

---

#### 2.2 ObservationRecord 类型统一

**现状**：`src/types/database.ts` 中的 `ObservationRecord` 接口只有 13 个字段，但实际 observations 表现在有 22 个字段（Phase 1/3 新增了 confidence, tags, has_preference, event_date, last_referenced_at, valid_until, superseded_by, related_observations）。多处代码用 `any` 类型绕过。

**修复方向**：
- 更新 `ObservationRecord` 接口包含所有字段
- 更新 `ObservationSearchResult` 扩展接口
- 消除 `(obs as any).confidence` 等类型断言
- 同步更新 `SessionSummaryRecord` 和 `SessionSummarySearchResult`

**预估**：中等改动，纯类型重构，不影响运行时。

---

#### 2.3 Markdown 双向同步完善

**现状**：`MarkdownExporter` 只做 DB → Markdown 单向导出。`markdown_sync` 表已创建但未使用 content hash 追踪。

**完善方向**：
- 导出时记录 content hash 到 `markdown_sync` 表
- SessionStart 时检测用户手动编辑（hash 变化）
- 单侧变更自动同步，双侧变更提示用户选择
- 冲突解决：`*.db-version.md` 保留 DB 版本，让用户决定

**预估**：中等改动。`MarkdownImporter`（对应 `MarkdownExporter`）需要新建。

---

#### 2.4 编译引擎隐私传播防护完善

**现状**：`PrivacyGuard` 检查 `<private>` 标签过滤 observations，但没有追踪哪些 session 包含隐私内容。

**完善方向**：
- 在 `sdk_sessions` 表标记 `has_private_content` 字段
- 编译时不仅过滤单条 observation，还跳过整个隐私 session 的所有 observation
- `compiled_knowledge` 的 `privacy_scope` 字段生效（当前始终是 'global'）
- 支持 project 级别隐私范围控制

---

### Tier 3：新功能方向

#### 3.1 多 Agent 协作支持

**场景**：用户同时使用多个 Claude Code session 或不同 IDE（Cursor + Claude Code）。

**方向**：
- 基于 Phase 1 的 WriteBuffer + LockManager，扩展为完整的多 session 协调
- Session 间知识传播：A session 的发现可以被 B session 的搜索命中
- 冲突检测：多个 session 同时改同一文件时提醒

---

#### 3.2 团队知识共享（跨机器同步）

**场景**：团队内多人（多台电脑）共享项目知识。目前同一台电脑上的 Claude Code / Cursor / Gemini CLI 已共享同一 DB，但不同电脑之间无法自动同步。

**当前基础设施**（已建好但未打通）：
- `TeamKnowledgeService` — 发布/获取/导入共享知识页（`shared_knowledge` 表）
- `MarkdownExporter/Importer` — 双向 Markdown 同步（`~/.agent-recall/readable/`）
- `CrossProjectService` — 跨项目模式识别

**缺失的最后一公里**：没有跨机器传输通道。

**方向 A：Git-Based 同步（推荐先做，轻量）**
- MarkdownExporter 自动导出编译知识到项目仓库的 `.agent-recall-shared/` 目录
- `git push/pull` 天然同步到团队成员
- 同事机器上的 MarkdownImporter 在 SessionStart 时检测并自动导入
- 共享粒度：**项目级**（跟随 git 仓库）
- 优点：零基础设施，复用现有 git 工作流
- 缺点：延迟高（取决于 push/pull 频率），冲突处理依赖 git merge

**方向 B：Worker P2P 同步（未来，实时）**
- 每台机器的 Worker Service 暴露同步端口
- 局域网 mDNS 自动发现对等节点
- 编译知识页变更自动广播（CRDT 或 last-write-wins）
- 共享粒度：**项目级 + 全局级**
- 优点：实时，自动，无 git 依赖
- 缺点：网络配置复杂，CRDT 冲突解决难度高

**共享层级设计**：

| 层级 | 内容 | 共享方式 |
|------|------|---------|
| **全局** | 用户通用偏好（"总是用 TypeScript strict"） | 不共享（个人配置） |
| **项目** | 编译知识页、实体、事实 | Git-based 或 P2P 同步 |
| **Session** | 原始 observations、checkpoints | 不共享（太细粒度） |

**权限模型**：
- 知识页默认"仅自己可见"
- 显式发布（`TeamKnowledgeService.shareKnowledge()`）后才进入共享池
- 导入方需确认（不自动覆盖本地知识）

---

#### 3.3 主动学习循环

**场景**：Agent 主动发现知识缺口并提问。

**方向**：
- 编译引擎 Orient 阶段检测知识空白（"项目有 auth 模块但没有相关 observations"）
- 在 SessionStart 注入提示："注意观察 auth 模块的变化"
- 利用 `CompletenessChecker` 的缺口检测驱动针对性提问

---

#### 3.4 跨项目知识迁移

**场景**：用户在项目 A 学到的技术模式应用到项目 B。

**方向**：
- `_global` 前缀的 entities/facts 已支持跨项目实体
- 编译引擎可以识别跨项目共通模式（如"用户总是用 TypeScript strict mode"）
- 自动将项目级知识提升为全局知识（复用 `sync_policies` 机制）

---

### Tier 4：性能与可靠性

#### 4.1 搜索 Benchmark 持续集成

**现状**：Benchmark 基础设施已就绪（`tests/benchmark/`），但只有初始基线数据。

**方向**：
- CI 集成：每次 PR 自动跑 benchmark，对比 R@5/NDCG
- 真实查询积累：从实际使用中收集查询→命中对，扩展到 100+ 查询
- A/B 测试框架：搜索参数调整（权重、窗口）可以量化对比

---

#### 4.2 编译引擎可观测性

**现状**：编译结果写入 DB，但过程不可见。

**方向**：
- `ActivityLog` 记录每次编译的输入/输出/耗时/token 成本
- Viewer UI 显示编译历史和趋势
- 编译失败告警（目前静默失败）

---

#### 4.3 数据备份与恢复

**现状**：SQLite 文件是唯一数据源，没有备份机制。

**方向**：
- 定期备份 `~/.agent-recall/agent-recall.db` 到 `~/.agent-recall/backups/`
- Markdown 导出作为人类可读备份（已部分就绪）
- 导入/恢复工具：从备份或 Markdown 重建 DB

---

## 技术债务清单

| 项目 | 位置 | 说明 |
|------|------|------|
| `ObservationRecord` 类型不完整 | `src/types/database.ts:64` | 缺少 Phase 1/3 新增的 9 个字段 |
| `PrivacyGuard` 本地类型定义 | `src/services/compilation/PrivacyGuard.ts:8` | 应引用统一类型而非本地接口 |
| Dashboard lint 集成 TODO | `src/services/dashboard/DashboardService.ts:101` | `lintWarnings = 0` 硬编码 |
| ConsolidateStage 无 AI 调用 | `src/services/compilation/stages/ConsolidateStage.ts:13` | MVP 文本拼接，注释标注待升级 |
| `Component` 类型维护 | `src/utils/logger.ts:18` | 新增服务需手动添加组件名，容易遗漏 |

---

## 建议的下一个 Sprint

如果继续开发，推荐这个优先顺序：

1. **AI 编译升级** (Tier 1.1) — 核心价值提升，从 MVP 到生产级
2. **Viewer 仪表盘** (Tier 1.2 部分) — 后端 ready，前端接入即可展示
3. **类型统一** (Tier 2.2) — 消除 `any` 断言，提升代码质量
4. **sqlite-vec 评估** (Tier 2.1) — 如果通过，可以消除 ChromaDB 依赖
5. **Benchmark CI** (Tier 4.1) — 确保搜索质量持续提升

---

## 参考文档

- 优化总设计：`design-references/optimization-plan.md`
- 执行 spec：`docs/superpowers/specs/2026-04-09-agent-recall-optimization-exec.md`
- Phase 1-3 实施计划：`docs/superpowers/plans/2026-04-09-phase*.md`
- MemPalace 分析：`design-references/karpathy-llm-wiki-analysis.md`
- 架构图：`design-references/agent-recall-arch.png`
