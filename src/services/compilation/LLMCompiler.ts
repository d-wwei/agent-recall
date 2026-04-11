/**
 * LLMCompiler — direct HTTP client for the Anthropic Messages API.
 *
 * Uses fetch() with no SDK dependency.
 * Tracks cumulative token usage across all successful calls.
 * Never throws — always returns null on failure.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LLMCompilerConfig {
  apiKey: string;
  model: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  messages: AnthropicMessage[];
}

interface AnthropicResponseBody {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ANTHROPIC_API_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.3;
const RETRY_DELAY_MS = 2000;

// ─── LLMCompiler ─────────────────────────────────────────────────────────────

/**
 * Makes direct HTTP calls to the Anthropic Messages API.
 *
 * Retryable errors: HTTP 429, HTTP 5xx, network failures.
 * Non-retryable: no API key, HTTP 4xx (except 429).
 */
export class LLMCompiler {
  private readonly config: LLMCompilerConfig;
  private totalTokensUsed: number = 0;

  constructor(config: LLMCompilerConfig) {
    this.config = config;
  }

  /** Returns true if an API key is configured. */
  isAvailable(): boolean {
    return this.config.apiKey.length > 0;
  }

  /** Returns the configured model ID. */
  getModel(): string {
    return this.config.model;
  }

  /** Returns the cumulative input + output tokens used across all successful calls. */
  getTotalTokensUsed(): number {
    return this.totalTokensUsed;
  }

  /**
   * Calls the Anthropic Messages API with the given prompt.
   *
   * @param prompt     The user message to send.
   * @param maxRetries Maximum number of retry attempts (default: 1).
   * @returns          The response text, or null on any failure.
   */
  async call(prompt: string, maxRetries: number = 1): Promise<string | null> {
    if (!this.isAvailable()) {
      return null;
    }

    const body: AnthropicRequestBody = {
      model: this.config.model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      messages: [{ role: 'user', content: prompt }],
    };

    let attemptsLeft = 1 + maxRetries;

    while (attemptsLeft > 0) {
      attemptsLeft--;

      try {
        const response = await fetch(ANTHROPIC_API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = (await response.json()) as AnthropicResponseBody;
          const text = data.content.find((c) => c.type === 'text')?.text ?? null;
          if (text !== null && data.usage) {
            this.totalTokensUsed += data.usage.input_tokens + data.usage.output_tokens;
          }
          return text;
        }

        // Retryable HTTP errors: 429 (rate limit) and 5xx (server errors)
        const shouldRetry = response.status === 429 || response.status >= 500;
        if (shouldRetry && attemptsLeft > 0) {
          await this.delay(RETRY_DELAY_MS);
          continue;
        }

        // Non-retryable HTTP error
        return null;
      } catch {
        // Network error — retry if attempts remain
        if (attemptsLeft > 0) {
          await this.delay(RETRY_DELAY_MS);
          continue;
        }
        return null;
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
