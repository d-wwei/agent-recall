/**
 * Integration tests for ConsolidateStage with AI merge wiring.
 *
 * Mock Justification: fetch is mocked only in tests that verify AI-path behaviour
 * (to avoid real HTTP calls while still exercising the wiring). All structural
 * and fallback-path tests use zero mocks — real ConsolidateStage, real types.
 *
 * Coverage:
 * - Fallback path (no API key) — execute() still works, returns valid pages
 * - execute() with AI merge disabled via env var — falls back to structuredMerge
 * - execute() with mocked API response — uses AI content, populates aiSuperseded + tokensUsed
 * - Multiple observations produce correct sourceObservationIds
 * - generateMermaidDiagrams() returns null when no API key
 * - generateMermaidDiagrams() returns a page with _mermaid_diagrams topic when LLM responds
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ConsolidateStage } from '../../../src/services/compilation/stages/ConsolidateStage.js';
import type { TopicGroup, CompiledPage, CompilationContext } from '../../../src/services/compilation/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT = 'ai-merge-test';

function makeCtx(): CompilationContext {
  return { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 };
}

function makeGroup(overrides: Partial<TopicGroup> = {}): TopicGroup {
  return {
    topic: 'auth',
    observations: [
      {
        id: 1,
        type: 'discovery',
        title: 'Found JWT auth',
        subtitle: null,
        narrative: 'Uses RS256 signing',
        facts: '["RS256"]',
        concepts: '["auth"]',
        project: PROJECT,
        created_at_epoch: Date.now() - 5000,
      },
      {
        id: 2,
        type: 'change',
        title: 'Switched to ECDSA',
        subtitle: null,
        narrative: null,
        facts: '[]',
        concepts: '["auth"]',
        project: PROJECT,
        created_at_epoch: Date.now(),
      },
    ],
    ...overrides,
  };
}

function makeSuccessResponse(text: string, inputTokens = 10, outputTokens = 20) {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

// ─── Environment helpers ───────────────────────────────────────────────────────

let savedApiKey: string | undefined;
let savedAiEnabled: string | undefined;
let savedMermaidEnabled: string | undefined;

beforeEach(() => {
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  savedAiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED;
  savedMermaidEnabled = process.env.AGENT_RECALL_MERMAID_ENABLED;
  // Default: clear API key so tests run in fallback mode unless explicitly set
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AGENT_RECALL_AI_MERGE_ENABLED;
  delete process.env.AGENT_RECALL_MERMAID_ENABLED;
});

afterEach(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  else delete process.env.ANTHROPIC_API_KEY;

  if (savedAiEnabled !== undefined) process.env.AGENT_RECALL_AI_MERGE_ENABLED = savedAiEnabled;
  else delete process.env.AGENT_RECALL_AI_MERGE_ENABLED;

  if (savedMermaidEnabled !== undefined) process.env.AGENT_RECALL_MERMAID_ENABLED = savedMermaidEnabled;
  else delete process.env.AGENT_RECALL_MERMAID_ENABLED;
});

// ─── Fallback path (no API key) ───────────────────────────────────────────────

describe('ConsolidateStage.execute() — fallback (no API key)', () => {
  it('returns a valid CompiledPage array', async () => {
    const stage = new ConsolidateStage();
    const pages = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(Array.isArray(pages)).toBe(true);
    expect(pages).toHaveLength(1);
  });

  it('page has correct topic', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(page.topic).toBe('auth');
  });

  it('page has non-empty content', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(typeof page.content).toBe('string');
    expect(page.content.length).toBeGreaterThan(0);
  });

  it('page content includes observation titles from structuredMerge', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(page.content).toContain('Found JWT auth');
    expect(page.content).toContain('Switched to ECDSA');
  });

  it('page confidence and classification are set', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(['high', 'medium', 'low']).toContain(page.confidence);
    expect(['status', 'fact', 'event']).toContain(page.classification);
  });

  it('aiSuperseded and tokensUsed are absent (no AI ran)', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(page.aiSuperseded).toBeUndefined();
    expect(page.tokensUsed).toBeUndefined();
  });

  it('evidenceTimeline has one entry per observation', async () => {
    const stage = new ConsolidateStage();
    const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

    expect(page.evidenceTimeline).toHaveLength(2);
    expect(page.evidenceTimeline[0].observationId).toBe(1);
    expect(page.evidenceTimeline[1].observationId).toBe(2);
  });
});

// ─── Explicit AI disable via env var ─────────────────────────────────────────

describe('ConsolidateStage.execute() — AI disabled via env var', () => {
  it('falls back to structuredMerge when AGENT_RECALL_AI_MERGE_ENABLED=false', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-would-not-be-called';
    process.env.AGENT_RECALL_AI_MERGE_ENABLED = 'false';

    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeSuccessResponse('should not appear')));
    globalThis.fetch = mockFetch as any;

    try {
      const stage = new ConsolidateStage();
      const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

      expect(mockFetch).not.toHaveBeenCalled();
      expect(page.content).toContain('Found JWT auth');
      expect(page.aiSuperseded).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Multiple observations → correct sourceObservationIds ────────────────────

describe('ConsolidateStage.execute() — sourceObservationIds', () => {
  it('collects all observation IDs from the group', async () => {
    const group: TopicGroup = {
      topic: 'api',
      observations: [
        { id: 10, type: 'feature', title: 'REST v2', subtitle: null, narrative: null, facts: '[]', concepts: '["api"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 20, type: 'feature', title: 'GraphQL endpoint', subtitle: null, narrative: null, facts: '[]', concepts: '["api"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 30, type: 'bugfix', title: 'Fixed 500', subtitle: null, narrative: null, facts: '[]', concepts: '["api"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    };

    const stage = new ConsolidateStage();
    const [page] = await stage.execute([group], new Map(), makeCtx());

    expect(page.sourceObservationIds).toContain(10);
    expect(page.sourceObservationIds).toContain(20);
    expect(page.sourceObservationIds).toContain(30);
    expect(page.sourceObservationIds).toHaveLength(3);
  });

  it('merges existing source IDs from knowledge map into new page', async () => {
    const existingKnowledge = new Map([
      ['auth', {
        id: 99, project: PROJECT, topic: 'auth',
        content: '## auth\n\n### Facts\n- Old fact',
        source_observation_ids: '[5, 6]',
        confidence: 'high', protected: 0, privacy_scope: 'global',
        version: 1, compiled_at: null, valid_until: null, superseded_by: null, created_at: '',
      }],
    ]);

    const group = makeGroup(); // IDs 1 and 2

    const stage = new ConsolidateStage();
    const [page] = await stage.execute([group], existingKnowledge, makeCtx());

    expect(page.sourceObservationIds).toContain(5);
    expect(page.sourceObservationIds).toContain(6);
    expect(page.sourceObservationIds).toContain(1);
    expect(page.sourceObservationIds).toContain(2);
    // No duplicates
    expect(new Set(page.sourceObservationIds).size).toBe(page.sourceObservationIds.length);
  });

  it('handles multiple topic groups independently', async () => {
    const groups: TopicGroup[] = [
      {
        topic: 'auth',
        observations: [
          { id: 1, type: 'discovery', title: 'Auth obs', subtitle: null, narrative: null, facts: '[]', concepts: '["auth"]', project: PROJECT, created_at_epoch: Date.now() },
        ],
      },
      {
        topic: 'db',
        observations: [
          { id: 2, type: 'feature', title: 'DB obs', subtitle: null, narrative: null, facts: '[]', concepts: '["db"]', project: PROJECT, created_at_epoch: Date.now() },
          { id: 3, type: 'bugfix', title: 'DB fix', subtitle: null, narrative: null, facts: '[]', concepts: '["db"]', project: PROJECT, created_at_epoch: Date.now() },
        ],
      },
    ];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), makeCtx());

    expect(pages).toHaveLength(2);
    const authPage = pages.find(p => p.topic === 'auth')!;
    const dbPage = pages.find(p => p.topic === 'db')!;

    expect(authPage.sourceObservationIds).toEqual([1]);
    expect(dbPage.sourceObservationIds).toEqual([2, 3]);
  });
});

// ─── AI merge path (mocked fetch) ────────────────────────────────────────────

describe('ConsolidateStage.execute() — AI merge path (mocked LLM)', () => {
  it('uses AI content when LLM responds and populates tokensUsed', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const aiContent = '### Status\n- ECDSA is active\n\n### Facts\n- JWT was original';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(makeSuccessResponse(aiContent, 50, 100))) as any;

    try {
      const stage = new ConsolidateStage();
      const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

      expect(page.content).toBe(aiContent);
      expect(page.tokensUsed).toBe(150); // 50 + 100
      expect(page.aiSuperseded).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to structuredMerge when LLM returns null (e.g. 500 error)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'fail' }), { status: 500 }))
    ) as any;

    try {
      const stage = new ConsolidateStage();
      const [page] = await stage.execute([makeGroup()], new Map(), makeCtx());

      // Fell back: content is from structuredMerge, no AI fields
      expect(page.content).toContain('## auth');
      expect(page.aiSuperseded).toBeUndefined();
      expect(page.tokensUsed).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── generateMermaidDiagrams ──────────────────────────────────────────────────

describe('ConsolidateStage.generateMermaidDiagrams()', () => {
  it('returns null when no API key is set', async () => {
    const stage = new ConsolidateStage();
    const pages: CompiledPage[] = [{
      topic: 'auth',
      content: '### Status\n- Active',
      sourceObservationIds: [1],
      confidence: 'high',
      classification: 'status',
      evidenceTimeline: [],
    }];

    const result = await stage.generateMermaidDiagrams(pages, makeCtx());
    expect(result).toBeNull();
  });

  it('returns null when AGENT_RECALL_MERMAID_ENABLED=false', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.AGENT_RECALL_MERMAID_ENABLED = 'false';

    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeSuccessResponse('should not run')));
    globalThis.fetch = mockFetch as any;

    try {
      const stage = new ConsolidateStage();
      const result = await stage.generateMermaidDiagrams([], makeCtx());

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns a CompiledPage with topic _mermaid_diagrams when LLM returns diagrams', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const mermaidResponse = '```mermaid\ngraph LR\n  A --> B\n```';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(makeSuccessResponse(mermaidResponse))) as any;

    try {
      const stage = new ConsolidateStage();
      const pages: CompiledPage[] = [
        {
          topic: 'auth',
          content: '### Status\n- Active',
          sourceObservationIds: [1, 2],
          confidence: 'high',
          classification: 'status',
          evidenceTimeline: [],
        },
        {
          topic: 'api',
          content: '### Facts\n- REST',
          sourceObservationIds: [3],
          confidence: 'high',
          classification: 'fact',
          evidenceTimeline: [],
        },
      ];

      const result = await stage.generateMermaidDiagrams(pages, makeCtx());

      expect(result).not.toBeNull();
      expect(result!.topic).toBe('_mermaid_diagrams');
      expect(result!.content).toContain('```mermaid');
      expect(result!.content).toContain('graph LR');
      expect(result!.sourceObservationIds).toContain(1);
      expect(result!.sourceObservationIds).toContain(2);
      expect(result!.sourceObservationIds).toContain(3);
      expect(result!.confidence).toBe('medium');
      expect(result!.classification).toBe('fact');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null when LLM response contains no mermaid blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(makeSuccessResponse('No diagrams here, just prose.'))
    ) as any;

    try {
      const stage = new ConsolidateStage();
      const result = await stage.generateMermaidDiagrams(
        [{ topic: 'auth', content: 'x', sourceObservationIds: [1], confidence: 'high', classification: 'fact', evidenceTimeline: [] }],
        makeCtx()
      );

      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null when pages array is empty (buildMermaidPrompt returns empty string)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';

    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeSuccessResponse('irrelevant')));
    globalThis.fetch = mockFetch as any;

    try {
      const stage = new ConsolidateStage();
      const result = await stage.generateMermaidDiagrams([], makeCtx());

      // buildMermaidPrompt returns '' for empty pages → LLM not called → null
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
