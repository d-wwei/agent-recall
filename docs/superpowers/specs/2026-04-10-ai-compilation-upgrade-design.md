# Agent Recall — AI Compilation Upgrade Design

> Date: 2026-04-10
> Status: Draft
> Author: Eli + Claude

---

## Problem

The compilation engine's ConsolidateStage uses text concatenation + deduplication (MVP). It cannot:
- Detect when newer information supersedes older information
- Identify contradictions between observations
- Produce coherent narratives (output reads like a log, not knowledge)
- Generate visual representations of knowledge (architecture diagrams, decision trees)

The `aiMerge()` method exists as an empty stub that falls back to `structuredMerge()`.

## Solution

Replace the `aiMerge()` stub with real LLM calls in a two-stage pipeline:

1. **Knowledge Synthesis** — Merge observations into coherent narratives with contradiction detection, supersession handling, and classification-aware strategies
2. **Diagram Generation** — Generate Mermaid diagrams from synthesized knowledge

Default model: Claude Opus 4.6. Configurable via settings. Graceful fallback to `structuredMerge()` when no API key is configured or LLM calls fail.

---

## Architecture

### Two-Stage LLM Pipeline

```
ConsolidateStage.execute()
  │
  ├─ For each TopicGroup:
  │   ├─ Has API key configured?
  │   │   ├─ YES → aiMerge() [Stage 1: Knowledge Synthesis]
  │   │   │         ├─ Build prompt (topic + existing knowledge + new observations)
  │   │   │         ├─ Call LLM (Anthropic Messages API)
  │   │   │         ├─ Parse structured Markdown response
  │   │   │         ├─ Extract conflicts/supersessions from response
  │   │   │         ├─ Track tokens used
  │   │   │         └─ On failure → fallback to structuredMerge()
  │   │   │
  │   │   └─ After all topics merged:
  │   │       └─ mermaidGenerate() [Stage 2: Diagram Generation]
  │   │           ├─ Build prompt (all compiled pages for project)
  │   │           ├─ Call LLM
  │   │           ├─ Validate Mermaid syntax
  │   │           ├─ Store diagram in compiled_knowledge (topic = "_diagrams")
  │   │           └─ On failure → skip silently (non-critical)
  │   │
  │   └─ NO → structuredMerge() [existing MVP, unchanged]
  │
  └─ Return CompiledPage[]
```

### LLM Client Module

New module: `src/services/compilation/LLMCompiler.ts`

Responsible for:
- Managing API client lifecycle (lazy initialization)
- Model selection from settings
- Token tracking per call
- Retry with exponential backoff (1 retry)
- Graceful error handling (never throws — returns null on failure)

Uses the existing `@anthropic-ai/claude-agent-sdk` dependency (already in package.json).

### Configuration

Settings in `~/.agent-recall/settings.json`:

```json
{
  "AGENT_RECALL_COMPILATION_MODEL": "claude-opus-4-6",
  "AGENT_RECALL_COMPILATION_ENABLED": "true",
  "AGENT_RECALL_AI_MERGE_ENABLED": "true",
  "AGENT_RECALL_MERMAID_ENABLED": "true"
}
```

- `COMPILATION_MODEL`: Any Anthropic model ID. Default: `claude-opus-4-6`. Switch to `claude-haiku-4-5-20251001` for cost savings.
- `AI_MERGE_ENABLED`: Toggle AI merge independently. `false` = always use structuredMerge().
- `MERMAID_ENABLED`: Toggle diagram generation independently. `false` = skip Stage 2.
- API key: Uses `ANTHROPIC_API_KEY` environment variable (already available to Claude Code users).

---

## Stage 1: Knowledge Synthesis Prompt

### Prompt Template

```
You are a knowledge compiler for an AI coding agent's memory system.

## Task
Merge the following observations about "{{topic}}" into a structured knowledge page.

## Existing Knowledge (if any)
{{existing_content OR "No existing knowledge for this topic."}}

## New Observations
{{observations formatted as:
  - [#ID] [TYPE] [DATE]: TITLE — NARRATIVE
}}

## Rules
1. **Status updates REPLACE old status.** If observation says "migrated from A to B", remove any mention of A as current state. Mark the old observation ID as superseded.
2. **Facts ACCUMULATE.** New facts are added, not replaced, unless they directly contradict an existing fact.
3. **Events go on the timeline.** Bugfixes, refactors, and deployments are timeline entries with dates.
4. **Detect contradictions.** If two observations say opposite things (e.g., "uses REST" vs "uses GraphQL"), flag it in a Conflicts section with both observation IDs.
5. **Be concise.** Each section should be scannable, not verbose. Strip redundancy.
6. **Preserve observation IDs.** Reference source observation IDs (e.g., "see #42") so the evidence trail is traceable.

## Output Format (strict Markdown)

### Status
Current state of this topic. Replace old values with new ones.

### Facts
Accumulated knowledge. One bullet per fact.

### Timeline
Chronological events. Format: `- [YYYY-MM-DD] Event description (#ID)`

### Conflicts (only if detected)
⚠️ Observation #X ("quote") contradicts #Y ("quote"). Recommended resolution: [keep newer / needs human review]

### Superseded
List of observation IDs that have been superseded by newer information, with reason.
Format: `- #OLD_ID superseded by #NEW_ID: reason`
```

### Response Parsing

Parse the LLM response into:
- `content`: The full Markdown (Status + Facts + Timeline sections)
- `conflicts`: Extracted from Conflicts section (observation ID pairs + description)
- `superseded`: Extracted from Superseded section (old ID → new ID + reason)

If parsing fails (malformed response), fallback to structuredMerge() for that topic.

---

## Stage 2: Diagram Generation Prompt

### Prompt Template

```
You are a diagram generator for a knowledge base.

## Compiled Knowledge Pages
{{all compiled pages for this project, one per topic}}

## Task
Generate Mermaid diagrams that visualize the relationships in this knowledge base.

Generate 1-3 diagrams from:
- **Architecture/dependency diagram** (if tech stack or module relationships are mentioned)
- **Decision timeline** (if decisions/migrations are mentioned)
- **Component relationship graph** (if multiple interacting systems are mentioned)

Only generate diagrams where there's enough data. Don't force diagrams for sparse topics.

## Output Format

For each diagram, output:

```mermaid:DIAGRAM_TITLE
[mermaid code]
```

Use graph LR or graph TD for architecture. Use timeline or gantt for chronological data.
```

### Storage

Diagrams are stored as a special compiled_knowledge entry:
- `topic`: `_mermaid_diagrams`
- `content`: Raw Mermaid code blocks with titles
- `confidence`: `medium` (AI-generated)
- `classification`: `fact`

---

## Fallback Strategy

```
AI merge requested
  ├─ ANTHROPIC_API_KEY set?
  │   ├─ NO → structuredMerge() (silent, no warning)
  │   └─ YES → AGENT_RECALL_AI_MERGE_ENABLED?
  │       ├─ NO → structuredMerge()
  │       └─ YES → call LLM
  │           ├─ Success → use AI result
  │           ├─ Rate limit / timeout → retry once
  │           │   ├─ Success → use AI result
  │           │   └─ Fail → structuredMerge() + log warning
  │           └─ Other error → structuredMerge() + log warning
```

Key principle: **compilation always succeeds.** LLM failure never blocks the pipeline.

---

## Token Tracking

Each LLM call records:
- `input_tokens`: Prompt tokens
- `output_tokens`: Completion tokens
- `model`: Model used
- `stage`: 'synthesis' or 'mermaid'

Summed per compilation run → written to `compilation_logs.tokens_used`.

Queryable via existing `CompilationLogger.getStats()` which already has `totalTokens` field.

---

## Doctor Integration

The existing `doctor` command will report AI merge status:

```
Compilation Engine
  ✓ Last compile: 2026-04-10 08:30
  ✓ Knowledge pages: 12
  ✓ AI merge: active (claude-opus-4-6)    ← NEW
  ○ Mermaid generation: enabled            ← NEW
```

Or when not configured:
```
  ○ AI merge: not configured (using text merge)
  ○ Mermaid generation: disabled
```

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/services/compilation/LLMCompiler.ts` | LLM client: API calls, retry, token tracking, model selection |
| `src/services/compilation/prompts.ts` | Prompt templates for synthesis and diagram generation |
| `src/services/compilation/ResponseParser.ts` | Parse LLM Markdown response into structured data (conflicts, superseded) |
| `tests/services/compilation/llm-compiler.test.ts` | Tests for LLM client (mocked API calls) |
| `tests/services/compilation/response-parser.test.ts` | Tests for response parsing |
| `tests/services/compilation/ai-merge-integration.test.ts` | Integration test for full AI merge flow |

### Modified Files

| File | Change |
|------|--------|
| `src/services/compilation/stages/ConsolidateStage.ts` | Replace aiMerge() stub with real LLM call via LLMCompiler |
| `src/services/compilation/stages/PruneStage.ts` | Handle superseded observation IDs from AI merge response |
| `src/cli/installer/lib/runtime-check.ts` | Add checkAIMerge() for doctor integration |
| `src/cli/installer/commands/doctor.ts` | Add compilation engine checks to doctor output |

---

## Costs

| Dimension | Estimate |
|-----------|----------|
| New code | ~400-600 lines TypeScript |
| Modified code | ~100 lines across 4 existing files |
| Runtime cost (Opus default) | ~$0.30/compilation × 10-15/month = $3-5/month |
| Runtime cost (Haiku option) | ~$0.02/compilation × 10-15/month = $0.20-0.30/month |
| Maintenance | Low — prompt templates are the main tuning surface |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM call fails | Low | Automatic fallback to structuredMerge(), compilation always completes |
| No API key configured | None | Silent fallback, doctor reports status |
| LLM output format unstable | Medium | ResponseParser with tolerant parsing + structure validation + fallback |
| Mermaid syntax errors | Low | Independent stage, failure doesn't affect knowledge pages |
| Cost surprise | Low | Gate system limits compilation frequency (every 2-3 days); configurable model |
| Prompt needs tuning | Expected | Prompts are in separate file, easy to iterate without touching logic |

---

## Success Criteria

1. `aiMerge()` produces coherent narratives (not line-by-line concatenation)
2. Contradictions between observations are detected and flagged
3. Superseded information is automatically marked (old observation → new observation)
4. Mermaid diagrams are generated for projects with sufficient data
5. `structuredMerge()` fallback works transparently when LLM is unavailable
6. Token usage is tracked per compilation run
7. `npx agent-recall doctor` reports AI merge configuration status

---

## Out of Scope

- Multi-provider support (Gemini, OpenAI) — future iteration
- Streaming LLM responses — not needed for batch compilation
- User-facing prompt customization — internal only for now
- Compilation scheduling changes — existing gate system unchanged
