# 共识算法引入评估：agent-recall 并发能力分析

> 日期：2026-04-10
> 评估对象：apex-forge 的四个共识算法（Raft / BFT / Gossip / CRDT）
> 目标系统：agent-recall 并发架构
> 结论：**不建议引入** — 问题域不匹配，当前方案已是最优解

---

## 1. 背景

agent-recall 已实现 Phase 1 并发安全：

| 组件 | 作用 |
|------|------|
| SQLite WAL + busy_timeout | 多读单写不阻塞，写冲突等 5 秒而非立即失败 |
| WriteBuffer | 每个 session 的 observations 先写缓冲区，SessionEnd 时一次性 flush |
| LockManager | 编译、lint 等后台任务用 PID 文件锁互斥，死进程的锁自动回收 |
| 非阻塞定期保存 | 每 10 次工具调用触发一次后台增量保存，长 session 不怕中途崩溃丢数据 |

apex-forge 项目中实现了四个共识算法（`src/consensus/`），计划用于 Phase 3 多 Agent 协调。本文评估将这四个算法引入 agent-recall 的可行性与必要性。

---

## 2. 四个共识算法概述

| 算法 | 源文件 | 解决什么问题 | apex-forge 计划用途 |
|------|--------|-------------|-------------------|
| Raft | `raft.ts` (671 行) | 多节点选 Leader，日志复制 | 多 Agent 任务分配的协调者选举 |
| BFT | `bft.ts` (230 行) | 容忍坏节点的投票共识 | Agent 输出可靠性投票 |
| Gossip | `gossip.ts` (175 行) | 状态在节点间传播 | Agent 间同步发现的事实 |
| CRDT | `crdt.ts` (202 行) | 无冲突自动合并 | memory.json 多 Agent 同时写入 |

**当前限制**：所有算法目前是同一进程内的模拟，节点之间通过内存直接调用方法，不是真正的网络通信。接入生产需要 IPC 层、序列化、节点发现、故障检测等基础设施。

---

## 3. 问题域不匹配分析

### 3.1 核心矛盾

| 维度 | 共识算法的假设 | agent-recall 的实际情况 |
|------|--------------|----------------------|
| 拓扑 | 多节点分布式，无共享存储 | 单机，共享一个 SQLite 文件 |
| 通信 | 网络 RPC，消息可能丢失/延迟 | 同一文件系统，直接函数调用 |
| 冲突来源 | 各节点独立决策，需要达成一致 | 多 session 并发写同一个 DB |
| 信任模型 | 节点可能拜占庭故障 | session 之间没有信任问题 |

### 3.2 逐个评估

#### Raft — 不适用

- **算法用途**：多个节点选一个 Leader 负责分配任务和日志复制
- **agent-recall 现状**：只有一个 worker-service（port 37777），不存在多 orchestrator 竞争
- **结论**：引入 Raft 解决的是一个不存在的问题。LockManager 的 PID 文件锁已经满足后台任务互斥需求，且实现远比 Raft 简单（~100 行 vs 671 行）

#### BFT — 不适用

- **算法用途**：容忍 f 个拜占庭故障节点（恶意/错误），需要 3f+1 个节点投票
- **agent-recall 现状**：session 不会"说谎"，每个 session 写自己的 observation，不存在需要验证数据正确性的场景
- **结论**：没有信任问题就不需要拜占庭容错。引入会增加三阶段协议的复杂度，无实际收益

#### Gossip — 不适用

- **算法用途**：在无中心化存储的节点间传播状态，达到最终一致性
- **agent-recall 现状**：所有 session 写同一个 SQLite 数据库，DB 本身就是 single source of truth
- **结论**：中心化存储不需要去中心化的状态传播协议

#### CRDT — 最接近有用，但仍不需要

- **算法用途**：断连节点离线修改后自动合并，无需锁、无需协调
- **agent-recall 现状**：
  - SQLite WAL 已解决并发读写
  - WriteBuffer 的 staging table 模式已实现 per-session 隔离
  - Content-hash dedup 已防止重复写入
- **结论**：CRDT 的核心价值在于离线独立修改后的自动合并。agent-recall 所有写入都直接到同一个 DB，不存在"断连后合并"的场景。用 CRDT 管理 observations 会比直接 INSERT INTO 复杂得多，但没有额外收益

---

## 4. 当前方案与共识算法的能力对应

当前方案已经用更简单的方式覆盖了共识算法要解决的核心需求：

```
SQLite WAL          → 多读单写不阻塞    （对应 CRDT 的"无冲突"需求）
busy_timeout=5000   → 写冲突优雅等待    （对应 Raft 的"排队"需求）
WriteBuffer         → session 隔离      （比 CRDT 更简单直接）
LockManager         → 后台任务互斥      （比 Raft 选举轻量得多）
Content-hash dedup  → 幂等性保证        （比 BFT 投票高效得多）
```

这套组合对"单机多 session 并发写 SQLite"这个问题域来说，已经是最优解。

---

## 5. 什么时候这些算法才有价值？

如果 agent-recall 未来演进到以下场景，这些算法才值得引入：

| 场景 | 适用算法 | 前置条件 |
|------|---------|---------|
| 多机部署（多个 worker-service 在不同机器上） | Raft 选主 | 需要 IPC 层、节点发现 |
| Agent 间协作投票（多个 agent 独立分析，投票决定结论） | BFT | 需要多 agent 编排框架 |
| 分布式缓存同步（每个 agent 有本地缓存，需最终一致性） | Gossip + CRDT | 需要脱离 SQLite 中心化存储 |
| 多 agent 独立写同一份 memory（断连后合并） | CRDT | 需要去中心化存储架构 |

---

## 6. 建议

1. **不引入共识算法** — 当前并发架构已满足需求，引入会增加 ~1278 行代码 + IPC 基础设施，但不解决实际问题
2. **优先激活 WriteBuffer** — 当前 WriteBuffer 已定义但未启用（migration 29 已创建 `observation_buffer` 表，但 observation store 仍直接写主表），激活后能进一步提升并发安全性
3. **完善 periodic save 可靠性** — 当前 in-memory 计数器会随 hook 进程退出而重置，可考虑持久化计数
4. **保留算法在 apex-forge** — 作为 Phase 3 多 Agent 协调的技术储备，等架构演进到分布式时再评估引入

---

## 附录：agent-recall 并发相关文件清单

| 组件 | 文件路径 |
|------|---------|
| WriteBuffer | `src/services/concurrency/WriteBuffer.ts` |
| LockManager | `src/services/concurrency/LockManager.ts` |
| Database PRAGMAs | `src/services/sqlite/Database.ts` |
| Observation Handler | `src/cli/handlers/observation.ts` |
| Observation Store | `src/services/sqlite/observations/store.ts` |
| Transactions | `src/services/sqlite/transactions.ts` |
| GateKeeper | `src/services/compilation/GateKeeper.ts` |
| WorkerService | `src/services/worker-service.ts` |
| Buffer Migration | `src/services/sqlite/migrations/runner.ts` (migration 29) |
