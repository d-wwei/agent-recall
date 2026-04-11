# AI Compilation Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ConsolidateStage's `aiMerge()` stub with real LLM-powered knowledge synthesis and Mermaid diagram generation.

**Architecture:** Two-stage LLM pipeline within ConsolidateStage: Stage 1 (knowledge synthesis) merges observations into coherent narratives with contradiction/supersession detection; Stage 2 (diagram generation) produces Mermaid diagrams from compiled knowledge. Uses direct `fetch()` to Anthropic Messages API — no new dependency. Graceful fallback to `structuredMerge()` on any failure.

**Tech Stack:** TypeScript, Anthropic Messages API (via fetch), existing compilation pipeline types.

**Spec:** `docs/superpowers/specs/2026-04-10-ai-compilation-upgrade-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/services/compilation/prompts.ts` | Prompt templates for synthesis and Mermaid generation |
| `src/services/compilation/ResponseParser.ts` | Parse LLM Markdown response → structured data (conflicts, superseded IDs) |
| `src/services/compilation/LLMCompiler.ts` | LLM client: fetch to Anthropic API, retry, token tracking, model selection |
| `tests/services/compilation/prompts.test.ts` | Tests for prompt building |
| `tests/services/compilation/response-parser.test.ts` | Tests for response parsing |
| `tests/services/compilation/llm-compiler.test.ts` | Tests for LLM client (mocked fetch) |
| `tests/services/compilation/ai-merge-integration.test.ts` | Integration test for full AI merge flow |

Modified files:
- `src/services/compilation/stages/ConsolidateStage.ts` — wire aiMerge() to LLMCompiler
- `src/services/compilation/stages/PruneStage.ts` — handle AI-extracted superseded IDs
- `src/services/compilation/types.ts` — add AIMergeResult interface
- `src/shared/SettingsDefaultsManager.ts` — add new settings
- `src/cli/installer/lib/runtime-check.ts` — add checkAIMerge()
- `src/cli/installer/commands/doctor.ts` — add compilation checks

---

### Task 1: Prompt templates

**Files:**
- Create: `src/services/compilation/prompts.ts`
- Test: `tests/services/compilation/prompts.test.ts`

- [ ] **Step 1: Write test for prompt building**

```typescript
// tests/services/compilation/prompts.test.ts
import { describe, it, expect } from 'bun:test';
import { buildSynthesisPrompt, buildMermaidPrompt } from '../../../src/services/compilation/prompts';
import type { ObservationRow } from '../../../src/services/compilation/types';

describe('buildSynthesisPrompt', () => {
  it('includes topic name in prompt', () => {
    const observations: ObservationRow[] = [{
      id: 1, type: 'discovery', title: 'React Hooks',
      subtitle: null, narrative: 'useCallback pattern found',
      facts: null, concepts: '["React"]', project: 'test', created_at_epoch: 1000
    }];
    const result = buildSynthesisPrompt('React', observations, null);
    expect(result).toContain('React');
  });

  it('includes all observations with IDs and types', () => {
    const observations: ObservationRow[] = [
      { id: 42, type: 'decision', title: 'Use GraphQL', subtitle: null,
        narrative: 'Team decided to migrate', facts: null, concepts: null,
        project: 'test', created_at_epoch: 1000 },
      { id: 43, type: 'bugfix', title: 'Fix N+1', subtitle: null,
        narrative: 'Resolved query issue', facts: null, concepts: null,
        project: 'test', created_at_epoch: 2000 },
    ];
    const result = buildSynthesisPrompt('API', observations, null);
    expect(result).toContain('#42');
    expect(result).toContain('#43');
    expect(result).toContain('decision');
    expect(result).toContain('bugfix');
    expect(result).toContain('Use GraphQL');
    expect(result).toContain('Fix N+1');
  });

  it('includes existing content when provided', () => {
    const observations: ObservationRow[] = [{
      id: 1, type: 'discovery', title: 'New fact', subtitle: null,
      narrative: 'Something new', facts: null, concepts: null,
      project: 'test', created_at_epoch: 1000
    }];
    const result = buildSynthesisPrompt('Topic', observations, '## Old content\nOld facts here');
    expect(result).toContain('Old content');
    expect(result).toContain('Old facts here');
  });

  it('says no existing knowledge when existingContent is null', () => {
    const observations: ObservationRow[] = [{
      id: 1, type: 'discovery', title: 'First', subtitle: null,
      narrative: 'First observation', facts: null, concepts: null,
      project: 'test', created_at_epoch: 1000
    }];
    const result = buildSynthesisPrompt('Topic', observations, null);
    expect(result).toContain('No existing knowledge');
  });
});

describe('buildMermaidPrompt', () => {
  it('includes all compiled pages', () => {
    const pages = [
      { topic: 'Auth', content: '## Auth\nJWT based' },
      { topic: 'API', content: '## API\nGraphQL' },
    ];
    const result = buildMermaidPrompt(pages);
    expect(result).toContain('Auth');
    expect(result).toContain('JWT based');
    expect(result).toContain('API');
    expect(result).toContain('GraphQL');
  });

  it('returns empty string for empty pages array', () => {
    const result = buildMermaidPrompt([]);
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/compilation/prompts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement prompt templates**

```typescript
// src/services/compilation/prompts.ts
import type { ObservationRow } from './types.js';

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().split('T')[0];
}

function formatObservation(obs: ObservationRow): string {
  const date = formatDate(obs.created_at_epoch);
  const title = obs.title || '(untitled)';
  const narrative = obs.narrative ? obs.narrative.substring(0, 300) : '';
  return `- [#${obs.id}] [${obs.type}] [${date}]: ${title} — ${narrative}`;
}

export function buildSynthesisPrompt(
  topic: string,
  observations: ObservationRow[],
  existingContent: string | null
): string {
  const existingBlock = existingContent
    ? `## Existing Knowledge\n\n${existingContent}`
    : '## Existing Knowledge\n\nNo existing knowledge for this topic.';

  const observationLines = observations.map(formatObservation).join('\n');

  return `You are a knowledge compiler for an AI coding agent's memory system.

## Task
Merge the following observations about "${topic}" into a structured knowledge page.

${existingBlock}

## New Observations

${observationLines}

## Rules
1. **Status updates REPLACE old status.** If an observation says "migrated from A to B", remove any mention of A as current state. Mark the old observation ID as superseded.
2. **Facts ACCUMULATE.** New facts are added, not replaced, unless they directly contradict an existing fact.
3. **Events go on the timeline.** Bugfixes, refactors, and deployments are timeline entries with dates.
4. **Detect contradictions.** If two observations say opposite things, flag it in a Conflicts section with both observation IDs.
5. **Be concise.** Each section should be scannable, not verbose. Strip redundancy.
6. **Preserve observation IDs.** Reference source observation IDs (e.g., "see #42") so the evidence trail is traceable.

## Output Format (strict Markdown)

### Status
Current state of this topic. Replace old values with new ones.

### Facts
Accumulated knowledge. One bullet per fact.

### Timeline
Chronological events. Format: \`- [YYYY-MM-DD] Event description (#ID)\`

### Conflicts
Only include this section if contradictions are detected.
Format: \`⚠️ Observation #X ("quote") contradicts #Y ("quote"). Resolution: [keep newer / needs human review]\`

### Superseded
List of observation IDs that have been superseded by newer information.
Format: \`- #OLD_ID superseded by #NEW_ID: reason\`
If no supersessions, omit this section.`;
}

export function buildMermaidPrompt(
  pages: Array<{ topic: string; content: string }>
): string {
  if (pages.length === 0) return '';

  const pagesBlock = pages
    .map(p => `### ${p.topic}\n\n${p.content}`)
    .join('\n\n---\n\n');

  return `You are a diagram generator for a knowledge base.

## Compiled Knowledge Pages

${pagesBlock}

## Task
Generate Mermaid diagrams that visualize the relationships in this knowledge base.

Generate 1-3 diagrams from:
- **Architecture/dependency diagram** (if tech stack or module relationships are mentioned)
- **Decision timeline** (if decisions/migrations are mentioned)
- **Component relationship graph** (if multiple interacting systems are mentioned)

Only generate diagrams where there's enough data. Don't force diagrams for sparse topics.

## Output Format

For each diagram, output exactly:

\`\`\`mermaid
[mermaid code here]
\`\`\`

Use graph LR or graph TD for architecture. Use timeline for chronological data. Put all text labels in quotes.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services/compilation/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/compilation/prompts.ts tests/services/compilation/prompts.test.ts
git commit -m "feat(compilation): add prompt templates for AI merge"
```

---

### Task 2: Response parser

**Files:**
- Create: `src/services/compilation/ResponseParser.ts`
- Test: `tests/services/compilation/response-parser.test.ts`

- [ ] **Step 1: Write test for response parsing**

```typescript
// tests/services/compilation/response-parser.test.ts
import { describe, it, expect } from 'bun:test';
import { parseSynthesisResponse, parseMermaidResponse, type ConflictEntry, type SupersededEntry } from '../../../src/services/compilation/ResponseParser';

describe('parseSynthesisResponse', () => {
  it('extracts content from well-formed response', () => {
    const response = `### Status
Using GraphQL API (migrated from REST, see #2)

### Facts
- JWT authentication implemented
- Rate limiting at 1000 req/min

### Timeline
- [2026-04-08] Migrated from REST to GraphQL (#2)
- [2026-04-09] Added rate limiting (#5)`;

    const result = parseSynthesisResponse(response);
    expect(result.content).toContain('GraphQL');
    expect(result.content).toContain('JWT');
    expect(result.content).toContain('2026-04-08');
  });

  it('extracts conflicts when present', () => {
    const response = `### Status
Mixed signals

### Facts
- Something

### Conflicts
⚠️ Observation #3 ("uses REST") contradicts #7 ("uses GraphQL"). Resolution: keep newer
⚠️ Observation #10 ("Node 16") contradicts #15 ("Node 20"). Resolution: needs human review`;

    const result = parseSynthesisResponse(response);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts[0].oldId).toBe(3);
    expect(result.conflicts[0].newId).toBe(7);
    expect(result.conflicts[1].oldId).toBe(10);
    expect(result.conflicts[1].newId).toBe(15);
  });

  it('extracts superseded entries when present', () => {
    const response = `### Status
Current state

### Superseded
- #3 superseded by #7: migrated from REST to GraphQL
- #10 superseded by #15: upgraded Node version`;

    const result = parseSynthesisResponse(response);
    expect(result.superseded).toHaveLength(2);
    expect(result.superseded[0]).toEqual({ oldId: 3, newId: 7, reason: 'migrated from REST to GraphQL' });
    expect(result.superseded[1]).toEqual({ oldId: 10, newId: 15, reason: 'upgraded Node version' });
  });

  it('returns empty conflicts and superseded when sections missing', () => {
    const response = `### Status
Simple status

### Facts
- One fact`;

    const result = parseSynthesisResponse(response);
    expect(result.conflicts).toHaveLength(0);
    expect(result.superseded).toHaveLength(0);
    expect(result.content).toContain('Simple status');
  });

  it('handles malformed response gracefully', () => {
    const result = parseSynthesisResponse('random text without sections');
    expect(result.content).toBe('random text without sections');
    expect(result.conflicts).toHaveLength(0);
    expect(result.superseded).toHaveLength(0);
  });
});

describe('parseMermaidResponse', () => {
  it('extracts mermaid code blocks', () => {
    const response = `Here are the diagrams:

\`\`\`mermaid
graph LR
  A["REST"] --> B["GraphQL"]
\`\`\`

And another:

\`\`\`mermaid
graph TD
  C["Auth"] --> D["JWT"]
\`\`\``;

    const result = parseMermaidResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('graph LR');
    expect(result[1]).toContain('graph TD');
  });

  it('returns empty array when no mermaid blocks', () => {
    const result = parseMermaidResponse('No diagrams here');
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/compilation/response-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement response parser**

```typescript
// src/services/compilation/ResponseParser.ts

export interface ConflictEntry {
  oldId: number;
  newId: number;
  description: string;
}

export interface SupersededEntry {
  oldId: number;
  newId: number;
  reason: string;
}

export interface SynthesisResult {
  content: string;
  conflicts: ConflictEntry[];
  superseded: SupersededEntry[];
}

export function parseSynthesisResponse(response: string): SynthesisResult {
  const conflicts = extractConflicts(response);
  const superseded = extractSuperseded(response);

  // Content = everything except the Conflicts and Superseded sections
  let content = response;
  // Remove Conflicts section if present
  content = content.replace(/### Conflicts[\s\S]*?(?=### |\s*$)/, '').trim();
  // Remove Superseded section if present
  content = content.replace(/### Superseded[\s\S]*?(?=### |\s*$)/, '').trim();

  return { content, conflicts, superseded };
}

function extractConflicts(text: string): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];
  // Match: ⚠️ Observation #X ("...") contradicts #Y ("..."). Resolution: ...
  const regex = /⚠️\s*Observation\s*#(\d+)\s*\("([^"]*)"\)\s*contradicts\s*#(\d+)\s*\("([^"]*)"\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    conflicts.push({
      oldId: parseInt(match[1], 10),
      newId: parseInt(match[3], 10),
      description: `"${match[2]}" vs "${match[4]}"`,
    });
  }
  return conflicts;
}

function extractSuperseded(text: string): SupersededEntry[] {
  const superseded: SupersededEntry[] = [];
  // Match: - #OLD_ID superseded by #NEW_ID: reason
  const regex = /-\s*#(\d+)\s*superseded\s*by\s*#(\d+):\s*(.+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    superseded.push({
      oldId: parseInt(match[1], 10),
      newId: parseInt(match[2], 10),
      reason: match[3].trim(),
    });
  }
  return superseded;
}

export function parseMermaidResponse(response: string): string[] {
  const diagrams: string[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    diagrams.push(match[1].trim());
  }
  return diagrams;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services/compilation/response-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/compilation/ResponseParser.ts tests/services/compilation/response-parser.test.ts
git commit -m "feat(compilation): add response parser for AI merge output"
```

---

### Task 3: LLM client

**Files:**
- Create: `src/services/compilation/LLMCompiler.ts`
- Test: `tests/services/compilation/llm-compiler.test.ts`

- [ ] **Step 1: Write test for LLM client**

```typescript
// tests/services/compilation/llm-compiler.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { LLMCompiler } from '../../../src/services/compilation/LLMCompiler';

describe('LLMCompiler', () => {
  it('isAvailable() returns false when no API key', () => {
    const compiler = new LLMCompiler({ apiKey: '', model: 'claude-opus-4-6' });
    expect(compiler.isAvailable()).toBe(false);
  });

  it('isAvailable() returns true when API key is set', () => {
    const compiler = new LLMCompiler({ apiKey: 'sk-test-key', model: 'claude-opus-4-6' });
    expect(compiler.isAvailable()).toBe(true);
  });

  it('getModel() returns configured model', () => {
    const compiler = new LLMCompiler({ apiKey: 'sk-test', model: 'claude-haiku-4-5-20251001' });
    expect(compiler.getModel()).toBe('claude-haiku-4-5-20251001');
  });

  it('getTotalTokensUsed() starts at 0', () => {
    const compiler = new LLMCompiler({ apiKey: 'sk-test', model: 'claude-opus-4-6' });
    expect(compiler.getTotalTokensUsed()).toBe(0);
  });

  it('call() returns null when no API key', async () => {
    const compiler = new LLMCompiler({ apiKey: '', model: 'claude-opus-4-6' });
    const result = await compiler.call('test prompt');
    expect(result).toBeNull();
  });

  it('call() returns response text on successful API call', async () => {
    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        content: [{ type: 'text', text: '### Status\nAll good' }],
        usage: { input_tokens: 100, output_tokens: 50 }
      }), { status: 200 }))
    ) as any;

    const compiler = new LLMCompiler({ apiKey: 'sk-test', model: 'claude-opus-4-6' });
    const result = await compiler.call('test prompt');

    expect(result).toBe('### Status\nAll good');
    expect(compiler.getTotalTokensUsed()).toBe(150);

    globalThis.fetch = originalFetch;
  });

  it('call() returns null on API error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('{"error": {"message": "rate limited"}}', { status: 429 }))
    ) as any;

    const compiler = new LLMCompiler({ apiKey: 'sk-test', model: 'claude-opus-4-6' });
    const result = await compiler.call('test prompt');

    expect(result).toBeNull();

    globalThis.fetch = originalFetch;
  });

  it('call() returns null on network error', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error('network down'))) as any;

    const compiler = new LLMCompiler({ apiKey: 'sk-test', model: 'claude-opus-4-6' });
    const result = await compiler.call('test prompt');

    expect(result).toBeNull();

    globalThis.fetch = originalFetch;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/services/compilation/llm-compiler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LLM client**

```typescript
// src/services/compilation/LLMCompiler.ts

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 4096;
const RETRY_DELAY_MS = 2000;

export interface LLMCompilerConfig {
  apiKey: string;
  model: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

export class LLMCompiler {
  private readonly apiKey: string;
  private readonly model: string;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(config: LLMCompilerConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }

  getModel(): string {
    return this.model;
  }

  getTotalTokensUsed(): number {
    return this.totalInputTokens + this.totalOutputTokens;
  }

  async call(prompt: string, maxRetries = 1): Promise<string | null> {
    if (!this.isAvailable()) return null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: MAX_TOKENS,
            temperature: 0.3,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!response.ok) {
          const isRetryable = response.status === 429 || response.status >= 500;
          if (isRetryable && attempt < maxRetries) {
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
            continue;
          }
          return null;
        }

        const data = (await response.json()) as AnthropicResponse;

        // Track tokens
        if (data.usage) {
          this.totalInputTokens += data.usage.input_tokens || 0;
          this.totalOutputTokens += data.usage.output_tokens || 0;
        }

        // Extract text from response
        const textBlock = data.content?.find(c => c.type === 'text');
        return textBlock?.text ?? null;
      } catch {
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        return null;
      }
    }

    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/services/compilation/llm-compiler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/compilation/LLMCompiler.ts tests/services/compilation/llm-compiler.test.ts
git commit -m "feat(compilation): add LLM client for AI merge"
```

---

### Task 4: Wire aiMerge() in ConsolidateStage

**Files:**
- Modify: `src/services/compilation/stages/ConsolidateStage.ts`
- Modify: `src/services/compilation/types.ts`
- Test: `tests/services/compilation/ai-merge-integration.test.ts`

- [ ] **Step 1: Add AIMergeResult to types.ts**

Add to the end of `src/services/compilation/types.ts`:

```typescript
export interface AIMergeResult {
  content: string;
  conflicts: Array<{ oldId: number; newId: number; description: string }>;
  superseded: Array<{ oldId: number; newId: number; reason: string }>;
  tokensUsed: number;
}
```

- [ ] **Step 2: Write integration test**

```typescript
// tests/services/compilation/ai-merge-integration.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { ConsolidateStage } from '../../../src/services/compilation/stages/ConsolidateStage';
import type { TopicGroup, ObservationRow, CompilationContext } from '../../../src/services/compilation/types';

describe('ConsolidateStage AI merge', () => {
  const makeObs = (id: number, type: string, title: string, narrative: string): ObservationRow => ({
    id, type, title, subtitle: null, narrative,
    facts: null, concepts: '["test"]', project: 'test-project',
    created_at_epoch: 1700000000 + id * 1000,
  });

  it('falls back to structuredMerge when no API key', () => {
    const stage = new ConsolidateStage();
    const groups: TopicGroup[] = [{
      topic: 'Auth',
      observations: [makeObs(1, 'discovery', 'JWT Auth', 'Uses JWT tokens')],
    }];
    const existing = new Map();
    const ctx = { project: 'test', db: {} as any, lastCompilationEpoch: 0 };

    const pages = stage.execute(groups, existing, ctx);
    expect(pages).toHaveLength(1);
    expect(pages[0].topic).toBe('Auth');
    expect(pages[0].content).toContain('JWT');
  });

  it('execute returns valid CompiledPage array', () => {
    const stage = new ConsolidateStage();
    const groups: TopicGroup[] = [
      {
        topic: 'API',
        observations: [
          makeObs(1, 'decision', 'Use REST', 'REST API chosen'),
          makeObs(2, 'change', 'Migrate to GraphQL', 'Switched from REST'),
          makeObs(3, 'bugfix', 'Fix N+1', 'Resolved N+1 query issue'),
        ],
      },
    ];
    const existing = new Map();
    const ctx = { project: 'test', db: {} as any, lastCompilationEpoch: 0 };

    const pages = stage.execute(groups, existing, ctx);
    expect(pages).toHaveLength(1);
    expect(pages[0].sourceObservationIds).toEqual([1, 2, 3]);
    expect(pages[0].confidence).toBeDefined();
    expect(pages[0].classification).toBeDefined();
    expect(pages[0].evidenceTimeline).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run test to verify it passes with existing code (baseline)**

Run: `bun test tests/services/compilation/ai-merge-integration.test.ts`
Expected: PASS (tests use fallback path which is existing structuredMerge)

- [ ] **Step 4: Modify ConsolidateStage.ts to wire real aiMerge()**

Replace the existing `aiMerge()` stub in `src/services/compilation/stages/ConsolidateStage.ts`.

Add new imports at the top of the file:

```typescript
import { LLMCompiler } from '../LLMCompiler.js';
import { buildSynthesisPrompt, buildMermaidPrompt } from '../prompts.js';
import { parseSynthesisResponse, parseMermaidResponse } from '../ResponseParser.js';
import type { AIMergeResult } from '../types.js';
```

Add a method to resolve LLM config (reads from environment/settings):

```typescript
private getLLMCompiler(): LLMCompiler | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const aiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';
  if (!apiKey || !aiEnabled) return null;
  const model = process.env.AGENT_RECALL_COMPILATION_MODEL || 'claude-opus-4-6';
  return new LLMCompiler({ apiKey, model });
}
```

Replace the `aiMerge()` stub with the real implementation:

```typescript
private async aiMerge(
  topic: string,
  observations: ObservationRow[],
  existingContent: string | null
): Promise<AIMergeResult | null> {
  const compiler = this.getLLMCompiler();
  if (!compiler) return null;

  const prompt = buildSynthesisPrompt(topic, observations, existingContent);
  const response = await compiler.call(prompt);
  if (!response) return null;

  const parsed = parseSynthesisResponse(response);
  return {
    content: parsed.content,
    conflicts: parsed.conflicts,
    superseded: parsed.superseded,
    tokensUsed: compiler.getTotalTokensUsed(),
  };
}
```

Update `execute()` to try `aiMerge()` first, fall back to `structuredMerge()`:

In the loop over topic groups, change the content generation from always calling `structuredMerge()` to:

```typescript
// Try AI merge first, fall back to structured merge
let content: string;
let aiSuperseded: Array<{ oldId: number; newId: number; reason: string }> = [];
const aiResult = await this.aiMerge(group.topic, group.observations, existingRow?.content ?? null);
if (aiResult) {
  content = aiResult.content;
  aiSuperseded = aiResult.superseded;
} else {
  content = this.structuredMerge(group.topic, group.observations, existingRow?.content ?? null);
}
```

This requires making `execute()` async. Change its signature from:
```typescript
execute(groups, existingKnowledge, _ctx): CompiledPage[]
```
to:
```typescript
async execute(groups, existingKnowledge, _ctx): Promise<CompiledPage[]>
```

Store `aiSuperseded` in the CompiledPage for PruneStage to process (add temporary field or store on context).

- [ ] **Step 5: Update CompilationEngine.ts to await ConsolidateStage**

In `src/services/compilation/CompilationEngine.ts`, the call to `this.consolidate.execute()` needs `await`:

Change:
```typescript
const pages = this.consolidate.execute(groups, existingKnowledge, ctx);
```
to:
```typescript
const pages = await this.consolidate.execute(groups, existingKnowledge, ctx);
```

- [ ] **Step 6: Run tests**

Run: `bun test tests/services/compilation/`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/services/compilation/stages/ConsolidateStage.ts src/services/compilation/types.ts src/services/compilation/CompilationEngine.ts tests/services/compilation/ai-merge-integration.test.ts
git commit -m "feat(compilation): wire aiMerge() to LLM client with fallback"
```

---

### Task 5: Mermaid diagram generation

**Files:**
- Modify: `src/services/compilation/stages/ConsolidateStage.ts`

- [ ] **Step 1: Add mermaidGenerate() method to ConsolidateStage**

After the `execute()` method, add:

```typescript
async generateMermaidDiagrams(
  pages: CompiledPage[],
  ctx: CompilationContext
): Promise<CompiledPage | null> {
  const mermaidEnabled = process.env.AGENT_RECALL_MERMAID_ENABLED !== 'false';
  if (!mermaidEnabled) return null;

  const compiler = this.getLLMCompiler();
  if (!compiler) return null;

  const pageData = pages.map(p => ({ topic: p.topic, content: p.content }));
  const prompt = buildMermaidPrompt(pageData);
  if (!prompt) return null;

  const response = await compiler.call(prompt);
  if (!response) return null;

  const diagrams = parseMermaidResponse(response);
  if (diagrams.length === 0) return null;

  const content = diagrams
    .map((d, i) => `\`\`\`mermaid\n${d}\n\`\`\``)
    .join('\n\n');

  return {
    topic: '_mermaid_diagrams',
    content,
    sourceObservationIds: pages.flatMap(p => p.sourceObservationIds),
    confidence: 'medium' as const,
    classification: 'fact' as const,
    evidenceTimeline: [],
  };
}
```

- [ ] **Step 2: Call mermaidGenerate() from CompilationEngine**

In `src/services/compilation/CompilationEngine.ts`, after the consolidate stage and before prune:

```typescript
const pages = await this.consolidate.execute(groups, existingKnowledge, ctx);

// Stage 2: Generate Mermaid diagrams (optional, non-blocking)
try {
  const diagramPage = await this.consolidate.generateMermaidDiagrams(pages, ctx);
  if (diagramPage) {
    pages.push(diagramPage);
  }
} catch {
  // Diagram generation failure is non-critical — skip silently
}

const result = this.prune.execute(pages, existingKnowledge, ctx);
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/services/compilation/`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/services/compilation/stages/ConsolidateStage.ts src/services/compilation/CompilationEngine.ts
git commit -m "feat(compilation): add Mermaid diagram generation (Stage 2)"
```

---

### Task 6: Settings + doctor integration

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts`
- Modify: `src/cli/installer/lib/runtime-check.ts`
- Modify: `src/cli/installer/commands/doctor.ts`

- [ ] **Step 1: Add new settings to SettingsDefaultsManager**

In `src/shared/SettingsDefaultsManager.ts`, add to the interface:

```typescript
AGENT_RECALL_COMPILATION_MODEL?: string;
AGENT_RECALL_AI_MERGE_ENABLED?: string;
AGENT_RECALL_MERMAID_ENABLED?: string;
```

Add to the DEFAULTS object:

```typescript
AGENT_RECALL_COMPILATION_MODEL: 'claude-opus-4-6',
AGENT_RECALL_AI_MERGE_ENABLED: 'true',
AGENT_RECALL_MERMAID_ENABLED: 'true',
```

- [ ] **Step 2: Add checkAIMerge() to runtime-check.ts**

Add to `src/cli/installer/lib/runtime-check.ts`:

```typescript
export async function checkAIMerge(): Promise<CheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const aiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';
  const model = process.env.AGENT_RECALL_COMPILATION_MODEL || 'claude-opus-4-6';

  if (!apiKey) {
    return {
      ok: true,
      label: 'AI merge: not configured (using text merge)',
      hint: 'Set ANTHROPIC_API_KEY to enable AI-powered knowledge compilation',
      category: 'compilation',
    };
  }

  if (!aiEnabled) {
    return {
      ok: true,
      label: 'AI merge: disabled by setting',
      category: 'compilation',
    };
  }

  return {
    ok: true,
    label: `AI merge: active (${model})`,
    category: 'compilation',
  };
}

export async function checkMermaid(): Promise<CheckResult> {
  const mermaidEnabled = process.env.AGENT_RECALL_MERMAID_ENABLED !== 'false';
  return {
    ok: true,
    label: `Mermaid generation: ${mermaidEnabled ? 'enabled' : 'disabled'}`,
    category: 'compilation',
  };
}
```

Add both to the `runAllChecks()` array.

- [ ] **Step 3: Add compilation section to doctor.ts**

In `src/cli/installer/commands/doctor.ts`, the `runDoctor()` function already iterates by category. The new checks use `category: 'compilation'` which is already in the category list. No changes needed to doctor.ts — the checks are auto-included via `runAllChecks()`.

Verify by running: `node bin/agent-recall.cjs doctor 2>&1 | grep -A5 "Compilation"`

- [ ] **Step 4: Rebuild CLI to include new checks**

Run: `npm run build`
Run: `node bin/agent-recall.cjs doctor`
Expected: Compilation Engine section appears with AI merge and Mermaid status

- [ ] **Step 5: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts src/cli/installer/lib/runtime-check.ts
git commit -m "feat(compilation): add AI merge settings and doctor checks"
```

---

### Task 7: PruneStage supersession handling + token tracking

**Files:**
- Modify: `src/services/compilation/stages/PruneStage.ts`
- Modify: `src/services/compilation/types.ts`

- [ ] **Step 1: Add aiSuperseded field to CompiledPage**

In `src/services/compilation/types.ts`, add to the `CompiledPage` interface:

```typescript
export interface CompiledPage {
  topic: string;
  content: string;
  sourceObservationIds: number[];
  confidence: 'high' | 'medium' | 'low';
  classification: 'status' | 'fact' | 'event';
  evidenceTimeline: EvidenceEntry[];
  aiSuperseded?: Array<{ oldId: number; newId: number; reason: string }>;
  tokensUsed?: number;
}
```

- [ ] **Step 2: Update PruneStage to handle AI supersession**

In `src/services/compilation/stages/PruneStage.ts`, in the `execute()` method, after calling `upsertPage()` for each page, add:

```typescript
// Handle AI-detected supersessions
if (page.aiSuperseded && page.aiSuperseded.length > 0) {
  for (const entry of page.aiSuperseded) {
    try {
      ctx.db.prepare(
        `UPDATE observations SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`
      ).run(entry.newId, entry.oldId);
    } catch {
      // Non-fatal — column may not exist in older schemas
    }
  }
}
```

Also accumulate `tokensUsed` across all pages and return it in the CompilationResult. Add to the result tracking:

```typescript
let totalTokens = 0;
for (const page of pages) {
  totalTokens += page.tokensUsed ?? 0;
  // ... existing upsert logic
}
```

Return `totalTokens` via the CompilationResult. Add `tokensUsed` to the `CompilationResult` interface in types.ts:

```typescript
export interface CompilationResult {
  pagesCreated: number;
  pagesUpdated: number;
  observationsProcessed: number;
  errors: string[];
  tokensUsed?: number;
}
```

- [ ] **Step 3: Wire token count to CompilationLogger**

In `CompilationEngine.ts`, the `completeLog()` call already accepts `tokensUsed`. Pass it from the result:

```typescript
logger.completeLog(logId, {
  ...result,
  tokensUsed: result.tokensUsed ?? 0,
});
```

- [ ] **Step 4: Update ConsolidateStage to pass aiSuperseded and tokensUsed**

In the `execute()` method of ConsolidateStage.ts, when building the CompiledPage, include the AI data:

```typescript
const compiledPage: CompiledPage = {
  topic: group.topic,
  content,
  sourceObservationIds: group.observations.map(o => o.id),
  confidence,
  classification,
  evidenceTimeline,
  aiSuperseded: aiResult ? aiResult.superseded : undefined,
  tokensUsed: aiResult ? aiResult.tokensUsed : undefined,
};
```

- [ ] **Step 5: Run all compilation tests**

Run: `bun test tests/services/compilation/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/services/compilation/types.ts src/services/compilation/stages/PruneStage.ts src/services/compilation/stages/ConsolidateStage.ts src/services/compilation/CompilationEngine.ts
git commit -m "feat(compilation): handle AI supersession in PruneStage + token tracking"
```

---

## Task Summary

| Task | What | Files | Depends On |
|------|------|-------|------------|
| 1 | Prompt templates | 2 new | — |
| 2 | Response parser | 2 new | — |
| 3 | LLM client | 2 new | — |
| 4 | Wire aiMerge() | 3 modified + 1 test | Tasks 1, 2, 3 |
| 5 | Mermaid generation | 2 modified | Tasks 1, 2, 3 |
| 6 | Settings + doctor | 2 modified | Task 4 |
| 7 | PruneStage + tokens | 3 modified | Task 4 |

Tasks 1-3 are independent and can be parallelized. Tasks 4-5 depend on 1-3. Tasks 6-7 depend on 4.
