# Agent Recall Optimization — Execution Spec

> Date: 2026-04-09
> Author: Eli + Claude
> Source: design-references/optimization-plan.md
> Strategy: A (Strict Phase Order, parallel within phases)

---

## Overview

Implement the full Agent Recall optimization plan (38 items across 7 layers) using strict phase ordering with parallel execution within each phase. Each phase builds on the previous phase's infrastructure.

## Execution Framework

### Branching
- Each Phase: `phase-N` branch from main
- Independent items within a phase: parallel agents in worktrees
- Phase complete → code review → squash merge to main → tag `v1.0.0-alpha.N`

### DB Migration Strategy
- Migrations start at #19 (current: 18)
- Each Phase: 1-2 consolidated migration files
- All migrations idempotent (`IF NOT EXISTS`)

### Testing Standard
- Every new/modified service gets unit tests
- Each Phase ends with `npm run test` full pass
- Search changes validated against benchmark (established in Phase 1)

### Code Organization
- New modules in `src/services/<module>/`
- Follow existing patterns: Orchestrator + Strategy + Service
- Types in `src/types/` or local `types.ts`

---

## Phase 1 — Foundation + Baseline (10 items)

**Branch**: `phase-1-foundation`
**Migration**: #19 (observations fields), #20 (observation_buffer)
**Goal**: Search baseline, concurrency safety, memory system ownership, low-cost search improvements

### Batch 1 (parallel, no dependencies)

#### 6.1 Retrieval Benchmark
- **Create**: `tests/benchmark/` directory
- **Content**: 50-100 query→expected-hit pairs covering:
  - Exact keyword queries (file names, function names)
  - Semantic queries ("how does auth work")
  - Temporal queries ("what did I do last week")
  - Preference queries ("what style do I prefer")
  - Assistant recall ("what did you suggest for X")
- **Metrics**: R@5 (recall at 5), NDCG (normalized discounted cumulative gain)
- **Output**: JSONL baseline file, runnable via `npm run benchmark`
- **Validation**: Run against current search, record baseline scores

#### 0.5 Multi-Session Concurrency
- **Layer 1**: Enable WAL mode + busy_timeout in `Database.ts`
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  ```
- **Layer 2**: `observation_buffer` table (migration #20)
  - Schema: `session_id TEXT, payload TEXT, created_at TEXT`
  - PostToolUse writes to buffer; SessionEnd flushes to main table
- **Layer 3**: Advisory lock via `LockManager.ts`
  - File lock at `~/.agent-recall/locks/<task>.lock` (PID + mtime)
  - Stale lock detection (PID alive check)
- **Layer 4**: Document Worker Service serial guarantee

#### 4.1 RECALL_PROTOCOL
- **Modify**: `ContextBuilder.ts` — add `RecallProtocolRenderer` section
- **Content**: 3 behavioral directives injected as L0 (always present)
  ```markdown
  ## Memory Protocol
  1. Before answering about past facts, search memory first — don't guess
  2. When discovering contradictions with memory, flag and request update
  3. User preferences and decisions are worth recording
  ```
- **Budget**: ~240 tokens fixed

#### 1.3a Observations First-Batch Fields
- **Migration #19**: Add columns to `observations`:
  - `confidence TEXT DEFAULT 'medium'` — high/medium/low
  - `tags TEXT DEFAULT '[]'` — JSON array
  - `has_preference BOOLEAN DEFAULT 0`
  - `event_date TEXT` — semantic date extracted by AI
  - `last_referenced_at TEXT` — updated on search hit
- **Modify**: AI extraction prompt (SDKAgent) to output confidence/tags/has_preference/event_date
- **Modify**: SearchManager to update `last_referenced_at` on hits

### Batch 2 (depends on Batch 1)

#### 1.4 ChromaDB Metadata Enrichment
- **Modify**: `ChromaSync.ts` — expand metadata on upsert:
  ```typescript
  metadata: {
    sqlite_id, doc_type, topic, observation_type,
    confidence,  // from 1.3a
    created_at_epoch
  }
  ```
- **Modify**: ChromaDB queries to use metadata pre-filtering
- **Depends on**: 1.3a (confidence/tags fields must exist)

#### 2.1 Adaptive Fusion Ranking
- **Create**: `src/services/worker/search/FusionRanker.ts`
  - Query type detection: `isExactMatch()` / `isSemanticQuery()`
  - Dynamic weights: exact → FTS5 0.7, semantic → Chroma 0.8, default → balanced
  - Multi-dimensional weighting: type weight + staleness decay (last_referenced_at)
  - `final_score = (w.chroma * similarity + w.fts5 * rank) * typeWeight * decayFactor`
- **Modify**: `SearchManager.ts` — merge FTS5 + Chroma results through FusionRanker
- **Validate**: Run benchmark, compare R@5/NDCG against Phase 1 baseline
- **Depends on**: 1.4 (metadata), 6.1 (benchmark)

#### 5.1 Non-Blocking Periodic Save
- **Modify**: PostToolUse hook — add counter, every N calls (default 10) fire async
- **Create**: `POST /api/incremental-save` endpoint in Worker
- **Behavior**: Worker does incremental summary in background, main conversation unblocked
- **Depends on**: 0.5 (concurrency safety for background writes)

### Batch 3 (depends on Batch 1-2, cross-system integration)

#### 0.1 Dual Memory System Coexistence
- **Create**: `src/services/sync/AutoMemorySync.ts`
  - SessionStart: scan `~/.claude/memory/*.md`
  - Parse frontmatter (type: user/feedback/project/reference)
  - user/feedback types: content hash → compare with `sync_state` table → import to agent_profiles/observations
  - project/reference types: skip (stay in auto memory)
- **Create**: `sync_state` table (migration, can share #19 or #20)
  - Schema: `file_path TEXT PRIMARY KEY, content_hash TEXT, last_sync_at TEXT`
- **Modify**: Context injection priority: Agent Recall > auto memory for overlapping data
- **Depends on**: 1.3a (imported observations get confidence etc.)

#### 0.3 .assistant/ Migration
- **Create**: `src/services/migration/AssistantMigrator.ts`
  - Mapping: USER.md→agent_profiles(user), STYLE.md→(style), WORKFLOW.md→(workflow)
  - MEMORY.md→observations (split by entries)
  - memory/projects/*.md→observations (project-tagged)
  - runtime/last-session.md→session_summaries
  - daily/*.md→skip
- **Flow**: detect → prompt user → migrate → rename to `.assistant.migrated/`
- **Trigger**: First bootstrap, or manual via bootstrap skill
- **Depends on**: 0.1 (sync architecture)

#### 0.4 Auto Memory Import
- **Extend**: `AutoMemorySync.ts` with `fullImport()` method
- **Behavior**: One-time full scan (vs 0.1's incremental sync)
- **Trigger**: First bootstrap or manual
- **Depends on**: 0.1

### Phase 1 Deliverables
- Benchmark baseline established (R@5, NDCG scores)
- SQLite WAL + write buffer + advisory locks
- Fusion ranking live, benchmark-validated improvement
- Auto memory sync channel operational
- .assistant/ migration tool ready
- RECALL_PROTOCOL injected every session

---

## Phase 2 — Smart Retrieval (5 items)

**Branch**: `phase-2-smart-retrieval`
**Migration**: None expected (schema from Phase 1 sufficient)
**Goal**: Transform context injection from "push recent N" to "layered budget + index + on-demand pull"

### Batch 1 (parallel)

#### 3.1 Tiered Memory Stack L0-L3
- **Create**: `src/services/context/TokenBudgetManager.ts`
  - TOTAL_BUDGET default 3000 tokens (configurable 1500-8000 in settings.json)
  - L0 (8%): persona + RECALL_PROTOCOL — always injected, incompressible
  - L1 (15%): active task + project index + last next_steps — always injected
  - L2 (60%): compiled knowledge highlights + recent observations — on-demand via index
  - L3 (17%): deep search results — explicit search triggers only
- **Create**: Project index mechanism (lightweight concept list + one-line summaries per topic)
- **Refactor**: `ContextBuilder.ts` to use TokenBudgetManager for section allocation
- **Support**: Per-project budget override via agent_profiles type=project_config

#### 2.2 Temporal Anchor Parsing
- **Create**: `src/services/worker/search/TemporalParser.ts`
  - Regex detection: "上周"/"三天前"/"last month"/"yesterday"/ISO dates
  - Convert to date range
  - Apply temporal boost: `temporal_boost = max(0.0, 0.40 * (1.0 - days_diff / window_days))`
- **Integrate**: Into FusionRanker as pre-processing step

#### 0.2 Incremental Bootstrap
- **Extend**: `PersonaService.ts`
  - Completeness schema: define required/recommended fields per profile type
  - `checkCompleteness(project)`: returns completeness percentage + gaps
  - Stale detection: fields >90 days since update → mark stale
- **Modify**: SessionStart logic:
  - `never` → full 3-round interview
  - `completed` + <80% complete → targeted 1-2 questions
  - `completed` + stale fields → confirmation prompts
  - `completed` + >=80% + no stale → skip

### Batch 2 (depends on Batch 1)

#### 4.3 Wake-Up Summary Streamlining
- **Modify**: `ObservationCompiler.ts` — observations show title + first fact only in L1
- **Modify**: Section renderers — full content only loaded for L2 on-demand
- **Enforce**: Strict token limits per section via TokenBudgetManager
- **Depends on**: 3.1 (L0-L3 framework)

#### 2.3 Preference Extraction + Synthetic Docs
- **Modify**: AI extraction prompt — detect preference expressions ("I prefer X", "always use X", "不要用Y")
- **Set**: `has_preference: true` on matching observations (uses 1.3a field)
- **Generate**: Synthetic document: "User preference: {content}" → sync to ChromaDB
- **Depends on**: 1.3a (has_preference field from Phase 1)

### Phase 2 Deliverables
- L0-L3 tiered injection with configurable token budget
- Project index for smart on-demand loading
- Temporal queries work ("what did I do last week" → precise date-filtered results)
- Preferences auto-detected and bridged for future queries
- Bootstrap stays fresh via incremental completeness checks
- Benchmark validation of all search improvements

---

## Phase 3 — Knowledge Compilation (6 items)

**Branch**: `phase-3-knowledge-compilation`
**Migration**: #21 (compiled_knowledge), #22 (observations phase 2 fields + observation_links)
**Goal**: Upgrade from "record + retrieve" to "record + compile + layered inject"

### Batch 1 (infrastructure)

#### 1.1 compiled_knowledge Table + Compilation Engine
- **Migration #21**: `compiled_knowledge` table
  ```sql
  CREATE TABLE compiled_knowledge (
    id INTEGER PRIMARY KEY,
    project TEXT NOT NULL,
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    source_observation_ids TEXT,
    confidence TEXT DEFAULT 'high',
    protected BOOLEAN DEFAULT 0,
    privacy_scope TEXT DEFAULT 'global',
    version INTEGER DEFAULT 1,
    compiled_at TEXT,
    valid_until TEXT,
    superseded_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Create**: `src/services/compilation/` module:
  - `CompilationEngine.ts` — orchestrator: gate check → 4 stages → result
  - `GateKeeper.ts` — 5 gates: feature / time(24h) / scan(10min) / session(>=5) / lock
  - `stages/OrientStage.ts` — read existing compiled_knowledge index
  - `stages/GatherStage.ts` — scan new observations, group by project+topic
  - `stages/ConsolidateStage.ts` — AI merge → knowledge pages (status/facts/events classification)
  - `stages/PruneStage.ts` — update index, control page size, clean contradictions
  - `PrivacyGuard.ts` — skip observations from sessions with `<private>` tags
  - `LockManager.ts` — file locks at `~/.agent-recall/locks/`
- **Trigger**: SessionEnd → check gates → fire-and-forget
- **Integrate**: ContextBuilder L2 reads compiled_knowledge instead of raw observations
- **UI**: Viewer dashboard shows compilation status

#### 1.3b Observations Second-Batch Fields + Links
- **Migration #22**: Add to `observations`:
  - `valid_until TEXT`
  - `superseded_by INTEGER`
  - `related_observations TEXT DEFAULT '[]'`
- **Migration #22**: Create `observation_links` table
  ```sql
  CREATE TABLE observation_links (
    id INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES observations(id),
    target_id INTEGER REFERENCES observations(id),
    relation TEXT NOT NULL,
    auto_detected BOOLEAN DEFAULT TRUE,
    created_at TEXT DEFAULT (datetime('now'))
  );
  ```
- **Written by**: Compilation engine (Lint sets superseded_by, Consolidate sets related)

### Batch 2 (depends on compilation engine)

#### 3.2 Knowledge Lint
- **Extend**: `PruneStage.ts` with lint checks:
  - Contradiction detection: same file, conflicting facts → flag conflict
  - Staleness: file significantly modified → mark related observations valid_until
  - Orphan demotion: old + unreferenced observations → lower search weight
  - Low confidence audit: priority review for confidence=low
  - Protected skip: protected=1 compiled pages untouched
- **Output**: Lint warnings visible in Viewer UI dashboard

#### 3.3 Hot/Cold Separation
- **Extend**: `ConsolidateStage.ts` with age-based processing:
  - Hot (≤7 days): full retention, ChromaDB vectors maintained
  - Warm (7-30 days): retained, search weight reduced
  - Cold (30+ days): similar observations merged into compiled_knowledge
  - Archive (90+ days): remove ChromaDB vectors, SQLite originals preserved
- **Behavior**: Incremental — each run processes newly qualifying data only

#### 4.2 Project-Adaptive Schema
- **Extend**: `PersonaService.ts` — new profile type `project_schema`
- **Content**: AI-learned project patterns (e.g., "this project frequently involves migrations")
- **Written by**: Compilation engine during Orient stage (detects recurring patterns)
- **Injected**: As part of L1 context for project-specific guidance

### Batch 3 (independent)

#### 5.2 PreCompact Sub-Agent Verification
- **Create**: `src/services/compaction/CompactionVerifier.ts`
  - Save agent: full session summary via Haiku
  - Verify agent: read-back check, compare against observations for gaps
  - Gap detected → supplementary observation written
- **Trigger**: Before context compaction
- **Optimization**: Skip verify agent if session has <3 observations
- **Cost**: ~$0.002/compaction (2x Haiku calls)

### Phase 3 Deliverables
- Knowledge compilation engine with 5-gate trigger + 4-stage pipeline
- Observations auto-compiled into structured knowledge pages
- Knowledge lint prevents memory corruption
- Hot/cold/archive lifecycle management
- Compaction verified for zero data loss
- Benchmark validation of compiled knowledge vs raw observations quality

---

## Phase 4 — Knowledge Graph (4 items)

**Branch**: `phase-4-knowledge-graph`
**Migration**: #23 (entities + facts), #24 (agent_diary)
**Goal**: Structured knowledge querying, entity relationships, temporal fact tracking

### Batch 1 (parallel)

#### 1.2 Entities + Facts Tables
- **Migration #23**: `entities` + `facts` tables (schema per optimization plan)
- **Create**: `src/services/knowledge-graph/` module:
  - `KnowledgeGraphService.ts` — CRUD + query entry point
  - `EntityResolver.ts` — ID format: `{project}:{type}:{name}`, global: `_global:{type}:{name}`
  - `FactExtractor.ts` — AI extracts structured facts during observation processing
  - `TemporalQuery.ts` — time-slice queries ("was X true on date Y")
- **Integrate**: AI extraction prompt outputs entities + facts alongside observations
- **Conflict handling**: Same name different type → `needs_review` flag, surfaced in Lint

#### 7.1 Agent Diary
- **Migration #24**: `agent_diary` table
  ```sql
  CREATE TABLE agent_diary (
    id INTEGER PRIMARY KEY,
    memory_session_id TEXT,
    project TEXT,
    entry TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  ```
- **Trigger**: SessionEnd → AI writes 3-5 sentence subjective diary
- **Inject**: As optional L1 component (most recent diary entry)
- **Viewer**: Diary tab in UI

### Batch 2 (depends on Batch 1)

#### 2.4 Two-Pass Assistant Retrieval
- **Modify**: `SearchManager.ts` — detect "你之前说过"/"you mentioned"/"你建议的" triggers
- **Pass 1**: Search observations to locate relevant sessions
- **Pass 2**: Search session transcripts for assistant utterances
- **Return**: Combined results with source attribution

#### 2.6 Query Result Writeback
- **Modify**: mem-search skill — after synthesis, prompt "Save this analysis for reuse?"
- **On confirm**: Write observation with `type=synthesis`
- **Anti-feedback-loop**:
  - synthesis type: 0.7x weight in fusion ranking
  - User gate: no auto-writeback
  - TTL: `valid_until = created + 90 days`
  - Excluded from compilation (1.1)

### Phase 4 Deliverables
- Structured entity + fact store with temporal validity
- Entity resolution with project isolation + global merging
- Agent diary for cross-session continuity
- Two-pass retrieval for "what did you say" queries
- Query synthesis reuse with feedback loop protection

---

## Phase 5 — Presentation Layer (5 items)

**Branch**: `phase-5-presentation`
**Migration**: #25 (markdown_sync)
**Goal**: Differentiated UX — dashboard, visualization, human-readable export, multi-format output

### Batch 1 (parallel)

#### 7.3 Memory Health Dashboard
- **Modify**: `src/ui/viewer/` — new dashboard components:
  - Total observations / this week's new
  - Distribution by type (decision/bugfix/feature/...)
  - Top 10 hot topics by concept
  - discovery_tokens cumulative ROI curve
  - Memory freshness distribution (7d / 30d / older)
  - ChromaDB sync status
  - Lint warning count
  - Monthly LLM call count + cost estimate
- **Create**: `GET /api/dashboard` endpoint aggregating all metrics

#### 7.6 Search Result Explanation
- **Modify**: Search response schema — add per-result:
  - `match_score: number`
  - `match_type: 'semantic' | 'keyword' | 'hybrid'`
  - `matched_keywords: string[]`
- **Modify**: Viewer UI — highlight keywords, show score badges
- **Extend**: facts with optional `source_ref` (file:line)
- **Viewer**: Fact → observation jump link

#### 7.4 Markdown Bidirectional Sync
- **Migration #25**: `markdown_sync` table
  ```sql
  CREATE TABLE markdown_sync (
    file_path TEXT PRIMARY KEY,
    last_db_hash TEXT,
    last_file_hash TEXT,
    last_sync_at TEXT
  );
  ```
- **Create**: `src/services/markdown-sync/` module:
  - `MarkdownSyncService.ts` — bidirectional sync orchestration
  - `MarkdownExporter.ts` — DB → `~/.agent-recall/readable/` (profile/, knowledge/, sessions/, observations/, diary/, graph.md)
  - `MarkdownImporter.ts` — detect user edits via content hash diff
  - `ConflictResolver.ts` — single-side auto-sync; both-side → prompt user
- **Trigger**: SessionEnd + post-compilation → export; SessionStart → import check
- **Features**: `[[wiki-link]]` cross-references, Obsidian compatible, git-friendly

### Batch 2 (depends on Batch 1)

#### 7.2 Knowledge Graph Visualization
- **Modify**: Viewer UI — new graph view tab
  - Nodes: entities (colored by type)
  - Edges: facts (labeled by predicate)
  - Filters: by project, entity type, time range
- **Extend**: Compilation engine — auto-generate Mermaid diagrams (file deps, architecture, decision trees)
- **Viewer**: Mermaid rendering support
- **Depends on**: Phase 4 entities/facts data + 7.3 dashboard framework

#### 7.5 Multi-Output Formats
- **Extend**: mem-search skill:
  - `format=slides` → Marp markdown (project presentations)
  - `format=timeline` → HTML timeline visualization
  - `format=weekly` → Weekly report markdown
- **Depends on**: 7.6 (search explanation data enriches outputs)

### Phase 5 Deliverables
- Full dashboard with health metrics + cost tracking
- Transparent search with scores, types, highlights
- Human-readable Markdown mirror with Obsidian compatibility
- Interactive knowledge graph visualization
- Multi-format export (slides, timeline, weekly report)

---

## Phase X — On-Demand Supplements (8 items)

**Branch**: `phase-x-supplements`
**Goal**: Polish, optimization, future architecture

### High Priority (immediately after Phase 5)

#### 5.3 Batch Ingestion
- **Modify**: Worker Service — add buffer queue
- **Behavior**: Adaptive window (10s initial + 5s extension per new item, 45s max)
- **Benefit**: Reduces AI calls, improves extraction context quality

#### 1.5 Idempotent Deduplication
- **Layer 1**: PostToolUse — same file + same tool + 5min window → check narrative similarity >0.9 → merge
- **Layer 2**: Write-time — ChromaDB query similarity >=0.92 → merge instead of insert

#### 8.1 MCP Server Native Integration
- **Extend**: `src/servers/` — wrap Worker API as MCP tools:
  - `recall_search`, `recall_timeline`, `recall_compile`, `recall_lint`, `recall_kg_query`
- **Config**: Add to `.mcp.json` for direct Claude access

### Medium Priority

#### 2.5 Optional LLM Rerank
- **Modify**: SearchManager — optional `llmRerank` flag
- **Behavior**: Top 10-20 → Haiku rerank prompt → return best. Graceful fallback.
- **Default**: Off. Cost: $0.001/query

#### 6.2 Activity Log Standardization
- **Format**: `[YYYY-MM-DD] operation | title — summary`
- **Operations**: session / ingest / query / lint / bootstrap

#### 5.4 Session Import
- **Create**: `POST /api/import` — JSONL conversation records → AI extraction pipeline

#### 5.5 Project File Mining
- **Create**: `POST /api/mine` — scan README/docs/CHANGELOG → extract project background

### Long-Term

#### 8.2 seekdb Unified Database
- **Status**: Monitor seekdb maturity (currently v1.2, 2.5k stars)
- **Alternative**: sqlite-vec as pure-SQLite vector solution
- **Timeline**: Evaluate for v2 architecture

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Phase 3 compilation engine complexity | Start with MVP (Consolidate only), add Prune/Lint incrementally |
| Markdown sync conflicts | Phase 5 initial: DB→MD export only; bidirectional after stabilization |
| Knowledge graph entity resolution noise | Phase 4: explicit relations only, no auto-resolution initially |
| observation_links noise | Set similarity threshold, surface only high-confidence links |
| Breaking existing tests | Each batch runs full test suite before merging |
| Token budget regression | Benchmark validates context quality after each Phase |

## Success Metrics

| Metric | Baseline (Phase 1) | Target (Phase 5) |
|--------|-------------------|-------------------|
| Search R@5 | TBD (benchmark) | +30% improvement |
| Context injection tokens | ~3000 (uncontrolled) | 3000 (budgeted, higher signal) |
| Observation dedup rate | 0% | >20% reduction in near-duplicates |
| Monthly LLM cost | ~$0.15 (extraction only) | <$0.51 (all features enabled) |
| Compilation coverage | 0% projects | 100% active projects compiled |
| Viewer engagement | Basic list | Dashboard + graph + search explanation |
