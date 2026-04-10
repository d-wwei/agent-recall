/**
 * LLMReranker - Optional LLM-based reranking for search results
 *
 * Takes a list of candidate observations ranked by FusionRanker and
 * asks an LLM to re-order them by relevance to the original query.
 *
 * Design goals:
 * - Default: disabled (enabled: false) — zero cost when unused
 * - Graceful fallback: any error returns null, caller keeps original ranking
 * - Mockable HTTP: the `callProvider` method can be overridden in tests
 * - MVP scope: prompt building + response parsing are pure functions; no
 *   real HTTP calls are made until a subclass or integration wires them in
 */

import { logger } from '../../../utils/logger.js';

export interface RerankerConfig {
  enabled: boolean;
  provider: 'claude' | 'gemini' | 'openrouter';
  /** LLM model to use. Defaults to claude-haiku-4-5 / gemini-2.0-flash-lite / openrouter default */
  model?: string;
  /** API key for the chosen provider */
  apiKey?: string;
}

export interface RerankCandidate {
  id: number;
  title: string;
  narrative: string;
}

export interface RerankResult {
  /** Observation IDs in reranked order (most relevant first) */
  rerankedIds: number[];
  /** The top-ranked observation ID */
  topId: number;
  /** Confidence score 0–1 (based on how many IDs were successfully parsed) */
  confidence: number;
  /** Total tokens consumed by the rerank call, if reported by the provider */
  tokensUsed?: number;
}

// ─── Default models per provider ──────────────────────────────────────────────

const DEFAULT_MODELS: Record<RerankerConfig['provider'], string> = {
  claude:      'claude-haiku-4-5',
  gemini:      'gemini-2.0-flash-lite',
  openrouter:  'anthropic/claude-haiku',
};

// ─── LLMReranker ──────────────────────────────────────────────────────────────

export class LLMReranker {
  constructor(protected config: RerankerConfig) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Rerank candidates by relevance to the query.
   *
   * Returns null on any failure so the caller can fall back to the original
   * ranking without surfacing errors to end users.
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[]
  ): Promise<RerankResult | null> {
    if (!this.isEnabled()) {
      return null;
    }

    if (candidates.length === 0) {
      return null;
    }

    // Single candidate — trivial, skip LLM call
    if (candidates.length === 1) {
      return {
        rerankedIds: [candidates[0].id],
        topId: candidates[0].id,
        confidence: 1.0,
      };
    }

    logger.debug(`LLMReranker.rerank: provider=${this.config.provider} candidates=${candidates.length}`);
    try {
      const prompt = this.buildPrompt(query, candidates);
      const rawResponse = await this.callProvider(prompt);
      const rerankedIds = this.parseResponse(rawResponse, candidates);

      if (rerankedIds.length === 0) {
        return null;
      }

      const confidence = rerankedIds.length / candidates.length;

      return {
        rerankedIds,
        topId: rerankedIds[0],
        confidence,
      };
    } catch {
      // Graceful fallback — never surface reranker errors to callers
      return null;
    }
  }

  /** Whether this reranker is active. */
  isEnabled(): boolean {
    return this.config.enabled === true;
  }

  // ─── Prompt / response helpers (public so tests can call them directly) ─────

  /**
   * Build the reranking prompt that will be sent to the LLM.
   *
   * Format:
   *   Given the query: "..."
   *   Rank these search results by relevance (most relevant first).
   *   Return ONLY the IDs as comma-separated numbers.
   *
   *   [id] title: narrative (first 200 chars)
   *   ...
   *
   *   Response format: id1,id2,id3,...
   */
  buildPrompt(query: string, candidates: RerankCandidate[]): string {
    const candidateLines = candidates
      .map((c) => `[${c.id}] ${c.title}: ${(c.narrative ?? '').substring(0, 200)}`)
      .join('\n');

    return (
      `Given the query: "${query}"\n\n` +
      `Rank these search results by relevance (most relevant first). Return ONLY the IDs as comma-separated numbers.\n\n` +
      `${candidateLines}\n\n` +
      `Response format: id1,id2,id3,...`
    );
  }

  /**
   * Parse the LLM response into an ordered list of observation IDs.
   *
   * - Accepts responses like "3,1,2" or "3, 1, 2" or extra whitespace/newlines
   * - Silently drops IDs that do not appear in the original candidate set
   * - Returns an empty array on completely malformed input (triggers null fallback)
   */
  parseResponse(raw: string, candidates: RerankCandidate[]): number[] {
    if (!raw || typeof raw !== 'string') {
      return [];
    }

    const validIds = new Set(candidates.map((c) => c.id));

    // Find the first comma-separated numeric sequence in the response.
    // This handles cases where the LLM adds extra explanation before/after.
    const match = raw.match(/(\d+(?:\s*,\s*\d+)*)/);
    if (!match) {
      return [];
    }

    const parsed = match[1]
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && validIds.has(n));

    // Deduplicate while preserving order
    const seen = new Set<number>();
    const deduped: number[] = [];
    for (const id of parsed) {
      if (!seen.has(id)) {
        seen.add(id);
        deduped.push(id);
      }
    }

    return deduped;
  }

  // ─── Provider call (override in subclasses / tests) ─────────────────────────

  /**
   * Send the prompt to the configured provider and return the raw text response.
   *
   * This method is intentionally isolated so that:
   *   1. Unit tests can override it without mocking `fetch`
   *   2. Integration code can swap providers by subclassing
   *
   * In the MVP implementation, this calls the provider REST API directly.
   */
  protected async callProvider(prompt: string): Promise<string> {
    const { provider, apiKey } = this.config;
    const model = this.config.model ?? DEFAULT_MODELS[provider];

    if (!apiKey) {
      throw new Error(`LLMReranker: no API key configured for provider "${provider}"`);
    }

    switch (provider) {
      case 'claude':
        return this._callClaude(prompt, model, apiKey);
      case 'gemini':
        return this._callGemini(prompt, model, apiKey);
      case 'openrouter':
        return this._callOpenRouter(prompt, model, apiKey);
      default:
        throw new Error(`LLMReranker: unknown provider "${provider}"`);
    }
  }

  // ─── Provider implementations ────────────────────────────────────────────────

  private async _callClaude(prompt: string, model: string, apiKey: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.[0]?.text ?? '';
  }

  private async _callGemini(prompt: string, model: string, apiKey: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 256 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  private async _callOpenRouter(prompt: string, model: string, apiKey: string): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
