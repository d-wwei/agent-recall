/**
 * Tests for useSessions hook logic
 *
 * Tests the response normalization that handles multiple API response formats.
 * The hook needs to handle:
 * - Direct array response
 * - { sessions: [...] }
 * - { results: [...] }
 * - { items: [...] }
 */
import { describe, it, expect } from 'bun:test';

interface SessionItem {
  id: number;
  session_id: string;
  project: string;
  started_at: string;
  ended_at: string | null;
  prompt_count: number;
  observation_count: number;
  summary?: string;
  created_at_epoch: number;
}

/**
 * Normalization logic extracted from useSessions hook
 */
function normalizeSessionResponse(data: any): SessionItem[] {
  const items: SessionItem[] = Array.isArray(data) ? data :
    (data.sessions || data.results || data.items || []);
  return items;
}

const mockSession: SessionItem = {
  id: 1,
  session_id: 'sess-abc-123',
  project: 'test-project',
  started_at: '2024-01-01T10:00:00Z',
  ended_at: '2024-01-01T12:00:00Z',
  prompt_count: 15,
  observation_count: 8,
  summary: 'Worked on auth system',
  created_at_epoch: 1704099600000,
};

describe('useSessions - response normalization', () => {
  it('should handle direct array response', () => {
    const data = [mockSession];
    const result = normalizeSessionResponse(data);
    expect(result).toHaveLength(1);
    expect(result[0].session_id).toBe('sess-abc-123');
  });

  it('should handle { sessions: [...] } format', () => {
    const data = { sessions: [mockSession] };
    const result = normalizeSessionResponse(data);
    expect(result).toHaveLength(1);
    expect(result[0].project).toBe('test-project');
  });

  it('should handle { results: [...] } format', () => {
    const data = { results: [mockSession] };
    const result = normalizeSessionResponse(data);
    expect(result).toHaveLength(1);
  });

  it('should handle { items: [...] } format', () => {
    const data = { items: [mockSession] };
    const result = normalizeSessionResponse(data);
    expect(result).toHaveLength(1);
  });

  it('should return empty array for empty object', () => {
    const result = normalizeSessionResponse({});
    expect(result).toEqual([]);
  });

  it('should return empty array for empty arrays in all formats', () => {
    expect(normalizeSessionResponse([])).toEqual([]);
    expect(normalizeSessionResponse({ sessions: [] })).toEqual([]);
    expect(normalizeSessionResponse({ results: [] })).toEqual([]);
    expect(normalizeSessionResponse({ items: [] })).toEqual([]);
  });

  it('should prefer sessions over results over items (evaluation order)', () => {
    // When multiple keys exist, JS `||` short-circuits on first truthy value
    const data = {
      sessions: [{ ...mockSession, id: 1 }],
      results: [{ ...mockSession, id: 2 }],
      items: [{ ...mockSession, id: 3 }],
    };
    const result = normalizeSessionResponse(data);
    expect(result[0].id).toBe(1); // sessions wins
  });

  it('should fall through to results when sessions is falsy', () => {
    const data = {
      sessions: null,
      results: [{ ...mockSession, id: 2 }],
    };
    const result = normalizeSessionResponse(data);
    expect(result[0].id).toBe(2);
  });
});

describe('useSessions - URL construction', () => {
  it('should build URL with limit parameter', () => {
    const params = new URLSearchParams({ limit: '50' });
    expect(params.toString()).toBe('limit=50');
  });

  it('should append project filter when set', () => {
    const params = new URLSearchParams({ limit: '50' });
    const projectFilter = 'my-project';
    if (projectFilter) params.append('project', projectFilter);
    expect(params.toString()).toContain('project=my-project');
  });

  it('should not append project filter when empty', () => {
    const params = new URLSearchParams({ limit: '50' });
    const projectFilter = '';
    if (projectFilter) params.append('project', projectFilter);
    expect(params.toString()).not.toContain('project');
  });
});
