# Phase 3: Knowledge Compilation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade from "record + retrieve" to "record + compile + layered inject". Build a knowledge compilation engine that converts fragmented observations into structured knowledge pages.

**Architecture:** CompilationEngine with 5-gate trigger + 4-stage pipeline (Orient→Gather→Consolidate→Prune), integrated into SessionEnd flow. Compiled knowledge replaces raw observations in L2 context injection. Knowledge Lint extends the Prune stage. Hot/cold separation manages data lifecycle.

**Tech Stack:** TypeScript (strict), SQLite (bun:sqlite), Haiku API (for compilation AI), Bun test

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/services/compilation/CompilationEngine.ts` | Orchestrator: gate check → 4 stages → result |
| `src/services/compilation/GateKeeper.ts` | 5 gates: feature/time/scan/session/lock |
| `src/services/compilation/stages/OrientStage.ts` | Read existing compiled_knowledge index |
| `src/services/compilation/stages/GatherStage.ts` | Scan new observations, group by project+topic |
| `src/services/compilation/stages/ConsolidateStage.ts` | AI merge → knowledge pages + cold data merge |
| `src/services/compilation/stages/PruneStage.ts` | Lint + clean contradictions + archive vectors |
| `src/services/compilation/PrivacyGuard.ts` | Skip observations from private sessions |
| `src/services/compilation/types.ts` | Shared types for compilation |
| `src/services/compaction/CompactionVerifier.ts` | PreCompact save + verify sub-agents |
| `tests/services/compilation/gate-keeper.test.ts` | GateKeeper tests |
| `tests/services/compilation/compilation-engine.test.ts` | Integration tests |
| `tests/services/compilation/privacy-guard.test.ts` | Privacy tests |
| `tests/services/compaction/compaction-verifier.test.ts` | Verifier tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/sqlite/migrations/runner.ts` | Migration 32 (compiled_knowledge), 33 (observation phase 2 fields + observation_links) |
| `src/services/sqlite/SessionStore.ts` | Add compiled_knowledge CRUD + observation query by epoch range |
| `src/services/context/ContextBuilder.ts` | L2 reads compiled_knowledge instead of raw observations |
| `src/services/persona/PersonaService.ts` | Add project_schema profile type |
| `src/services/worker-service.ts` | Register compilation trigger endpoint |
| `src/cli/handlers/session-complete.ts` | Fire compilation check after session end |

---

## Batch 1: Schema + Foundation

### Task 1: compiled_knowledge Table (Migration 32)

- Create: migration 32 in `src/services/sqlite/migrations/runner.ts`
- Add to `SessionStore.ts`: CRUD methods for compiled_knowledge

**Migration 32:**
```sql
CREATE TABLE IF NOT EXISTS compiled_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  source_observation_ids TEXT DEFAULT '[]',
  confidence TEXT DEFAULT 'high',
  protected INTEGER DEFAULT 0,
  privacy_scope TEXT DEFAULT 'global',
  version INTEGER DEFAULT 1,
  compiled_at TEXT,
  valid_until TEXT,
  superseded_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ck_project ON compiled_knowledge(project);
CREATE INDEX IF NOT EXISTS idx_ck_topic ON compiled_knowledge(project, topic);
```

**SessionStore methods:**
- `getCompiledKnowledge(project: string): CompiledKnowledgeRow[]`
- `upsertCompiledKnowledge(project, topic, content, sourceIds, confidence): number`
- `getObservationsSinceEpoch(project, sinceEpoch): ObservationRecord[]`

### Task 2: Observations Phase 2 Fields + observation_links (Migration 33)

**Migration 33:**
```sql
ALTER TABLE observations ADD COLUMN valid_until TEXT;
ALTER TABLE observations ADD COLUMN superseded_by INTEGER;
ALTER TABLE observations ADD COLUMN related_observations TEXT DEFAULT '[]';

CREATE TABLE IF NOT EXISTS observation_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES observations(id),
  target_id INTEGER REFERENCES observations(id),
  relation TEXT NOT NULL,
  auto_detected INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_links_source ON observation_links(source_id);
CREATE INDEX IF NOT EXISTS idx_obs_links_target ON observation_links(target_id);
```

### Task 3: GateKeeper

**5 gates (all must pass):**
1. Feature gate: `SettingsDefaultsManager.getBool('AGENT_RECALL_COMPILATION_ENABLED')` (default true)
2. Time gate: last compilation ≥ 24 hours ago
3. Scan throttle: last gate check ≥ 10 minutes ago
4. Session gate: ≥ 5 new sessions since last compilation
5. Lock gate: `LockManager.acquire('compilation')`

### Task 4: CompilationEngine + Stages

**Orient:** Read compiled_knowledge index for project
**Gather:** Query observations since last compilation, group by topic (first concept)
**Consolidate:** For each topic group, call AI to merge observations into knowledge page. Classify as status/fact/event. Skip private observations.
**Prune:** Update compiled_knowledge, mark superseded observations

### Task 5: PrivacyGuard

Filter observations containing `<private>` tags from compilation input.

### Task 6: Knowledge Lint (3.2)

Extends PruneStage:
- Contradiction detection (same file, conflicting facts)
- Staleness marking (file modified → mark old observations valid_until)
- Orphan demotion (old + unreferenced → lower weight)
- Low confidence audit
- Protected page skip

### Task 7: Hot/Cold Separation (3.3)

Extends ConsolidateStage with age-based processing:
- Hot (≤7d): full retention
- Warm (7-30d): search weight reduced
- Cold (30d+): merge into compiled_knowledge
- Archive (90d+): remove ChromaDB vectors

### Task 8: PreCompact Verifier (5.2)

Save agent + verify agent for compaction. Skip verify if <3 observations.

### Task 9: Project-Adaptive Schema (4.2)

New `project_schema` profile type in PersonaService. AI detects recurring patterns during Orient stage.

### Task 10: Integration Wiring

- Wire compilation trigger into SessionEnd
- ContextBuilder L2 reads compiled_knowledge
- Final test suite

---

## Execution Notes

This is the largest Phase. Tasks 1-3 are foundations. Task 4 is the core engine. Tasks 5-9 extend it. Task 10 wires everything.

For the AI consolidation call, use the existing agent infrastructure (SDKAgent/GeminiAgent/OpenRouterAgent pattern). Build a simple prompt that takes grouped observations and outputs structured knowledge pages in XML format.
