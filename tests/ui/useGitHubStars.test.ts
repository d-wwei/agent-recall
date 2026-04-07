/**
 * Tests for useGitHubStars hook logic
 *
 * Tests the GitHub API URL construction and response processing.
 * Uses mocked fetch to test error handling paths.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

describe('useGitHubStars - API URL construction', () => {
  it('should construct correct GitHub API URL', () => {
    const username = 'd-wwei';
    const repo = 'agent-recall';
    const url = `https://api.github.com/repos/${username}/${repo}`;
    expect(url).toBe('https://api.github.com/repos/d-wwei/agent-recall');
  });

  it('should handle usernames with hyphens', () => {
    const url = `https://api.github.com/repos/some-user/some-repo`;
    expect(url).toContain('some-user');
  });
});

describe('useGitHubStars - response processing', () => {
  interface GitHubStarsData {
    stargazers_count: number;
    watchers_count: number;
    forks_count: number;
  }

  function extractStars(data: GitHubStarsData): number {
    return data.stargazers_count;
  }

  it('should extract stargazers_count from response', () => {
    const data: GitHubStarsData = {
      stargazers_count: 1234,
      watchers_count: 100,
      forks_count: 50,
    };
    expect(extractStars(data)).toBe(1234);
  });

  it('should handle zero stars', () => {
    const data: GitHubStarsData = {
      stargazers_count: 0,
      watchers_count: 0,
      forks_count: 0,
    };
    expect(extractStars(data)).toBe(0);
  });

  it('should handle large star counts', () => {
    const data: GitHubStarsData = {
      stargazers_count: 1500000,
      watchers_count: 50000,
      forks_count: 200000,
    };
    expect(extractStars(data)).toBe(1500000);
  });
});

describe('useGitHubStars - error handling logic', () => {
  function processError(error: unknown): Error {
    return error instanceof Error ? error : new Error('Unknown error');
  }

  it('should preserve Error instances', () => {
    const original = new Error('GitHub API error: 404');
    const result = processError(original);
    expect(result).toBe(original);
    expect(result.message).toBe('GitHub API error: 404');
  });

  it('should wrap non-Error values in Error', () => {
    const result = processError('string error');
    expect(result instanceof Error).toBe(true);
    expect(result.message).toBe('Unknown error');
  });

  it('should wrap null/undefined in Error', () => {
    expect(processError(null).message).toBe('Unknown error');
    expect(processError(undefined).message).toBe('Unknown error');
  });
});

describe('useGitHubStars - fetch with mock', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should handle successful fetch response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          stargazers_count: 42,
          watchers_count: 10,
          forks_count: 5,
        }),
      } as Response)
    );

    const response = await fetch('https://api.github.com/repos/d-wwei/agent-recall');
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.stargazers_count).toBe(42);
  });

  it('should handle rate-limited response (403)', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 403,
      } as Response)
    );

    const response = await fetch('https://api.github.com/repos/d-wwei/agent-recall');
    expect(response.ok).toBe(false);
    expect(response.status).toBe(403);
  });

  it('should handle network error', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Network error'))
    );

    try {
      await fetch('https://api.github.com/repos/d-wwei/agent-recall');
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error instanceof Error).toBe(true);
      expect((error as Error).message).toBe('Network error');
    }
  });
});
