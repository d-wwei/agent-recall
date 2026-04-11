/**
 * Tests for LLMCompiler — direct HTTP wrapper for the Anthropic Messages API.
 *
 * Mock Justification: fetch is mocked to avoid real HTTP calls.
 * - All tests verify behavior without hitting the network.
 */

import { describe, it, expect, mock } from 'bun:test';
import { LLMCompiler } from '../../../src/services/compilation/LLMCompiler.js';
import type { LLMCompilerConfig } from '../../../src/services/compilation/LLMCompiler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<LLMCompilerConfig> = {}): LLMCompilerConfig {
  return {
    apiKey: 'test-api-key',
    model: 'claude-3-5-haiku-20241022',
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

function makeErrorResponse(status: number) {
  return new Response(JSON.stringify({ error: { message: 'Error' } }), { status });
}

// ─── isAvailable ─────────────────────────────────────────────────────────────

describe('LLMCompiler.isAvailable', () => {
  it('returns false when apiKey is empty string', () => {
    const compiler = new LLMCompiler(makeConfig({ apiKey: '' }));
    expect(compiler.isAvailable()).toBe(false);
  });

  it('returns true when apiKey is non-empty', () => {
    const compiler = new LLMCompiler(makeConfig({ apiKey: 'sk-abc123' }));
    expect(compiler.isAvailable()).toBe(true);
  });
});

// ─── getModel ─────────────────────────────────────────────────────────────────

describe('LLMCompiler.getModel', () => {
  it('returns the configured model ID', () => {
    const compiler = new LLMCompiler(makeConfig({ model: 'claude-3-opus-20240229' }));
    expect(compiler.getModel()).toBe('claude-3-opus-20240229');
  });
});

// ─── getTotalTokensUsed ───────────────────────────────────────────────────────

describe('LLMCompiler.getTotalTokensUsed', () => {
  it('starts at 0 before any calls', () => {
    const compiler = new LLMCompiler(makeConfig());
    expect(compiler.getTotalTokensUsed()).toBe(0);
  });
});

// ─── call — no API key ───────────────────────────────────────────────────────

describe('LLMCompiler.call — no API key', () => {
  it('returns null immediately without calling fetch', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeSuccessResponse('should not be called')));
    globalThis.fetch = mockFetch as any;

    try {
      const compiler = new LLMCompiler(makeConfig({ apiKey: '' }));
      const result = await compiler.call('hello');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── call — success ───────────────────────────────────────────────────────────

describe('LLMCompiler.call — success', () => {
  it('returns the response text on a 200 response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(makeSuccessResponse('compiled knowledge text')),
    ) as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      const result = await compiler.call('summarize this');
      expect(result).toBe('compiled knowledge text');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accumulates tokens from the usage field', async () => {
    const originalFetch = globalThis.fetch;
    // First call: 10 input + 20 output = 30
    // Second call: 5 input + 15 output = 20
    // Total: 50
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(makeSuccessResponse('first', 10, 20));
      return Promise.resolve(makeSuccessResponse('second', 5, 15));
    }) as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      await compiler.call('prompt one');
      expect(compiler.getTotalTokensUsed()).toBe(30);
      await compiler.call('prompt two');
      expect(compiler.getTotalTokensUsed()).toBe(50);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── call — HTTP errors ───────────────────────────────────────────────────────

describe('LLMCompiler.call — HTTP 429 retry', () => {
  it('retries once on 429 and returns null if second attempt also fails', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeErrorResponse(429)));
    globalThis.fetch = mockFetch as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      const result = await compiler.call('prompt', 1);
      expect(result).toBeNull();
      // Called twice: original attempt + one retry
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries once on 500 and returns null if second attempt also fails', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeErrorResponse(500)));
    globalThis.fetch = mockFetch as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      const result = await compiler.call('prompt', 1);
      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns null immediately on 400 without retrying', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.resolve(makeErrorResponse(400)));
    globalThis.fetch = mockFetch as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      const result = await compiler.call('prompt', 1);
      expect(result).toBeNull();
      // Called only once — no retry for 4xx other than 429
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── call — network error ─────────────────────────────────────────────────────

describe('LLMCompiler.call — network error', () => {
  it('retries once on network error and returns null if second attempt also fails', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() => Promise.reject(new Error('Network failure')));
    globalThis.fetch = mockFetch as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      const result = await compiler.call('prompt', 1);
      expect(result).toBeNull();
      // Called twice: original attempt + one retry
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('never throws — always returns null on failure', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error('Fatal network error'))) as any;

    try {
      const compiler = new LLMCompiler(makeConfig());
      // Should not throw
      await expect(compiler.call('prompt', 1)).resolves.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
