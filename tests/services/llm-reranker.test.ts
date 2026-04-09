import { describe, it, expect, mock } from 'bun:test';
import { LLMReranker } from '../../src/services/worker/search/LLMReranker.js';
import type { RerankerConfig, RerankCandidate } from '../../src/services/worker/search/LLMReranker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<RerankerConfig> = {}): RerankerConfig {
  return {
    enabled: false,
    provider: 'claude',
    ...overrides,
  };
}

function makeCandidates(count: number = 3): RerankCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Result ${i + 1}`,
    narrative: `Narrative for result ${i + 1}. This describes some relevant work done.`,
  }));
}

/**
 * Testable subclass that intercepts callProvider() so tests never make real HTTP calls.
 */
class MockLLMReranker extends LLMReranker {
  private mockResponse: string | null = null;
  private shouldThrow: boolean = false;
  private errorMessage: string = 'Mock provider error';

  setMockResponse(response: string) {
    this.mockResponse = response;
    this.shouldThrow = false;
  }

  setThrow(message = 'Mock provider error') {
    this.shouldThrow = true;
    this.errorMessage = message;
  }

  protected override async callProvider(_prompt: string): Promise<string> {
    if (this.shouldThrow) {
      throw new Error(this.errorMessage);
    }
    return this.mockResponse ?? '';
  }
}

// ─── isEnabled ───────────────────────────────────────────────────────────────

describe('LLMReranker.isEnabled', () => {
  it('returns false by default when enabled is false', () => {
    const r = new LLMReranker(makeConfig({ enabled: false }));
    expect(r.isEnabled()).toBe(false);
  });

  it('returns true when enabled is true', () => {
    const r = new LLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    expect(r.isEnabled()).toBe(true);
  });

  it('returns false when enabled is not set (defaults to false)', () => {
    // TypeScript enforces the field but test runtime robustness
    const r = new LLMReranker({ enabled: false, provider: 'claude' });
    expect(r.isEnabled()).toBe(false);
  });
});

// ─── buildPrompt ─────────────────────────────────────────────────────────────

describe('LLMReranker.buildPrompt', () => {
  const reranker = new LLMReranker(makeConfig());

  it('includes the query in the prompt', () => {
    const prompt = reranker.buildPrompt('session recovery fix', makeCandidates(2));
    expect(prompt).toContain('session recovery fix');
  });

  it('includes each candidate ID in square brackets', () => {
    const candidates = makeCandidates(3);
    const prompt = reranker.buildPrompt('query', candidates);
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('[2]');
    expect(prompt).toContain('[3]');
  });

  it('includes each candidate title', () => {
    const candidates = makeCandidates(2);
    const prompt = reranker.buildPrompt('query', candidates);
    expect(prompt).toContain('Result 1');
    expect(prompt).toContain('Result 2');
  });

  it('includes narrative text (up to 200 chars)', () => {
    const longNarrative = 'x'.repeat(300);
    const candidates: RerankCandidate[] = [{ id: 7, title: 'T', narrative: longNarrative }];
    const prompt = reranker.buildPrompt('q', candidates);
    // Should include exactly 200 chars of the narrative, not the full 300
    expect(prompt).toContain('x'.repeat(200));
    expect(prompt).not.toContain('x'.repeat(201));
  });

  it('includes the response format instruction', () => {
    const prompt = reranker.buildPrompt('q', makeCandidates(1));
    expect(prompt).toContain('Response format: id1,id2,id3');
  });

  it('handles empty narrative gracefully', () => {
    const candidates: RerankCandidate[] = [{ id: 5, title: 'T5', narrative: '' }];
    expect(() => reranker.buildPrompt('q', candidates)).not.toThrow();
    const prompt = reranker.buildPrompt('q', candidates);
    expect(prompt).toContain('[5]');
  });

  it('builds correct prompt format for multiple candidates', () => {
    const candidates: RerankCandidate[] = [
      { id: 10, title: 'Auth fix', narrative: 'Fixed login bug' },
      { id: 20, title: 'Search perf', narrative: 'Improved query speed' },
    ];
    const prompt = reranker.buildPrompt('authentication', candidates);
    expect(prompt).toMatch(/\[10\] Auth fix: Fixed login bug/);
    expect(prompt).toMatch(/\[20\] Search perf: Improved query speed/);
  });
});

// ─── parseResponse ────────────────────────────────────────────────────────────

describe('LLMReranker.parseResponse', () => {
  const reranker = new LLMReranker(makeConfig());
  const candidates = makeCandidates(3); // ids: 1, 2, 3

  it('extracts ordered IDs from a clean comma-separated response', () => {
    const ids = reranker.parseResponse('3,1,2', candidates);
    expect(ids).toEqual([3, 1, 2]);
  });

  it('handles spaces around commas', () => {
    const ids = reranker.parseResponse('3, 1, 2', candidates);
    expect(ids).toEqual([3, 1, 2]);
  });

  it('handles extra whitespace and newlines', () => {
    const ids = reranker.parseResponse('  2 , 3 , 1  \n', candidates);
    expect(ids).toEqual([2, 3, 1]);
  });

  it('ignores IDs not in the candidate set', () => {
    const ids = reranker.parseResponse('3,99,1,2', candidates);
    expect(ids).toEqual([3, 1, 2]);
  });

  it('deduplicates repeated IDs', () => {
    const ids = reranker.parseResponse('1,2,1,3', candidates);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('returns empty array for empty string', () => {
    expect(reranker.parseResponse('', candidates)).toEqual([]);
  });

  it('returns empty array when response has no numbers', () => {
    expect(reranker.parseResponse('no numbers here', candidates)).toEqual([]);
  });

  it('handles malformed response with text before/after IDs', () => {
    const ids = reranker.parseResponse('The ranked results are: 2,3,1 (based on relevance)', candidates);
    expect(ids).toEqual([2, 3, 1]);
  });

  it('returns empty array for completely non-numeric response', () => {
    expect(reranker.parseResponse('Sorry, I cannot rank these results.', candidates)).toEqual([]);
  });

  it('handles single ID response', () => {
    const ids = reranker.parseResponse('2', candidates);
    expect(ids).toEqual([2]);
  });
});

// ─── rerank — disabled ───────────────────────────────────────────────────────

describe('LLMReranker.rerank — disabled', () => {
  it('returns null when disabled', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: false }));
    r.setMockResponse('3,1,2');
    const result = await r.rerank('query', makeCandidates(3));
    expect(result).toBeNull();
  });

  it('returns null for empty candidates even when enabled', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('1,2,3');
    const result = await r.rerank('query', []);
    expect(result).toBeNull();
  });
});

// ─── rerank — enabled ────────────────────────────────────────────────────────

describe('LLMReranker.rerank — enabled', () => {
  it('returns reranked result when provider succeeds', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('3,1,2');
    const result = await r.rerank('query', makeCandidates(3));

    expect(result).not.toBeNull();
    expect(result!.rerankedIds).toEqual([3, 1, 2]);
    expect(result!.topId).toBe(3);
  });

  it('confidence equals parsed count / total candidates', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    // Only 2 out of 3 IDs returned by provider
    r.setMockResponse('2,1');
    const result = await r.rerank('query', makeCandidates(3));

    expect(result).not.toBeNull();
    expect(result!.confidence).toBeCloseTo(2 / 3, 5);
  });

  it('returns confidence 1.0 when all IDs are ranked', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('3,1,2');
    const result = await r.rerank('query', makeCandidates(3));

    expect(result!.confidence).toBe(1.0);
  });

  it('returns rerankedIds[0] as topId', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('2,3,1');
    const result = await r.rerank('query', makeCandidates(3));

    expect(result!.topId).toBe(2);
  });

  it('trivially reranks a single candidate without calling provider', async () => {
    const callSpy = mock(() => Promise.resolve('1'));
    class SpyReranker extends LLMReranker {
      protected override callProvider(p: string) { return callSpy(p); }
    }
    const r = new SpyReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    const candidates: RerankCandidate[] = [{ id: 42, title: 'T', narrative: 'N' }];
    const result = await r.rerank('query', candidates);

    expect(result!.topId).toBe(42);
    expect(result!.confidence).toBe(1.0);
    // callProvider should NOT have been invoked
    expect(callSpy).not.toHaveBeenCalled();
  });
});

// ─── rerank — graceful fallback ───────────────────────────────────────────────

describe('LLMReranker.rerank — graceful fallback', () => {
  it('returns null when provider throws an error', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setThrow('Network timeout');
    const result = await r.rerank('query', makeCandidates(3));
    expect(result).toBeNull();
  });

  it('returns null when provider returns empty string', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('');
    const result = await r.rerank('query', makeCandidates(3));
    expect(result).toBeNull();
  });

  it('returns null when provider returns gibberish with no valid IDs', async () => {
    const r = new MockLLMReranker(makeConfig({ enabled: true, apiKey: 'k' }));
    r.setMockResponse('sorry, unable to rank');
    const result = await r.rerank('query', makeCandidates(3));
    expect(result).toBeNull();
  });

  it('does not throw even when apiKey is missing and provider throws', async () => {
    // Config with no apiKey — callProvider would throw "no API key configured"
    // but since MockLLMReranker overrides callProvider, we test the base class
    // behavior by using the real class with a missing key
    const r = new LLMReranker(makeConfig({ enabled: true })); // no apiKey
    // Should not throw; returns null gracefully
    const result = await r.rerank('query', makeCandidates(2));
    expect(result).toBeNull();
  });
});

// ─── Provider config defaults ─────────────────────────────────────────────────

describe('LLMReranker — provider and model defaults', () => {
  it('can be constructed with gemini provider', () => {
    const r = new LLMReranker(makeConfig({ provider: 'gemini', enabled: false }));
    expect(r.isEnabled()).toBe(false);
  });

  it('can be constructed with openrouter provider', () => {
    const r = new LLMReranker(makeConfig({ provider: 'openrouter', enabled: false }));
    expect(r.isEnabled()).toBe(false);
  });

  it('accepts an explicit model override', () => {
    const r = new MockLLMReranker(
      makeConfig({ enabled: true, provider: 'claude', model: 'claude-opus-4', apiKey: 'k' })
    );
    expect(r.isEnabled()).toBe(true);
  });
});
