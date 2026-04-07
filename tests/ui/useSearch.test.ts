/**
 * Tests for useSearch hook logic
 *
 * Tests the search result normalization logic that converts both
 * unified and legacy API response formats into a consistent internal format.
 *
 * No React rendering needed - these test the data transformation logic.
 */
import { describe, it, expect } from 'bun:test';

interface SearchResult {
  id: number;
  type: 'observation' | 'summary' | 'prompt';
  title: string;
  snippet: string;
  project: string;
  created_at_epoch: number;
}

interface SearchResponse {
  results?: SearchResult[];
  observations?: any[];
  summaries?: any[];
  prompts?: any[];
}

/**
 * Normalization logic extracted from useSearch hook
 */
function normalizeSearchResults(data: SearchResponse): SearchResult[] {
  const normalized: SearchResult[] = [];

  if (data.results) {
    normalized.push(...data.results);
  } else {
    if (data.observations) {
      for (const o of data.observations) {
        normalized.push({
          id: o.id,
          type: 'observation',
          title: o.title || 'Untitled',
          snippet: o.narrative || o.subtitle || o.text || '',
          project: o.project,
          created_at_epoch: o.created_at_epoch,
        });
      }
    }
    if (data.summaries) {
      for (const s of data.summaries) {
        normalized.push({
          id: s.id,
          type: 'summary',
          title: s.request || `Session #${s.id}`,
          snippet: s.investigated || s.completed || '',
          project: s.project,
          created_at_epoch: s.created_at_epoch,
        });
      }
    }
    if (data.prompts) {
      for (const p of data.prompts) {
        normalized.push({
          id: p.id,
          type: 'prompt',
          title: `Prompt #${p.prompt_number || p.id}`,
          snippet: p.prompt_text || '',
          project: p.project,
          created_at_epoch: p.created_at_epoch,
        });
      }
    }
  }

  normalized.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
  return normalized;
}

describe('useSearch - normalizeSearchResults', () => {
  describe('unified format (data.results)', () => {
    it('should pass through unified results directly', () => {
      const data: SearchResponse = {
        results: [
          { id: 1, type: 'observation', title: 'Test', snippet: 'text', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Test');
    });

    it('should sort unified results by recency', () => {
      const data: SearchResponse = {
        results: [
          { id: 1, type: 'observation', title: 'Old', snippet: '', project: 'proj', created_at_epoch: 1000 },
          { id: 2, type: 'observation', title: 'New', snippet: '', project: 'proj', created_at_epoch: 3000 },
          { id: 3, type: 'observation', title: 'Mid', snippet: '', project: 'proj', created_at_epoch: 2000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result[0].title).toBe('New');
      expect(result[1].title).toBe('Mid');
      expect(result[2].title).toBe('Old');
    });
  });

  describe('legacy format (separate arrays)', () => {
    it('should normalize observations from legacy format', () => {
      const data: SearchResponse = {
        observations: [
          { id: 10, title: 'Obs Title', narrative: 'some narrative', project: 'proj-a', created_at_epoch: 5000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('observation');
      expect(result[0].title).toBe('Obs Title');
      expect(result[0].snippet).toBe('some narrative');
    });

    it('should use "Untitled" for observations without title', () => {
      const data: SearchResponse = {
        observations: [
          { id: 10, title: null, narrative: 'text', project: 'proj', created_at_epoch: 5000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result[0].title).toBe('Untitled');
    });

    it('should fall back to subtitle then text for observation snippet', () => {
      const withSubtitle: SearchResponse = {
        observations: [
          { id: 1, title: 'T', subtitle: 'sub text', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      expect(normalizeSearchResults(withSubtitle)[0].snippet).toBe('sub text');

      const withText: SearchResponse = {
        observations: [
          { id: 1, title: 'T', text: 'raw text', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      expect(normalizeSearchResults(withText)[0].snippet).toBe('raw text');

      const withNothing: SearchResponse = {
        observations: [
          { id: 1, title: 'T', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      expect(normalizeSearchResults(withNothing)[0].snippet).toBe('');
    });

    it('should normalize summaries from legacy format', () => {
      const data: SearchResponse = {
        summaries: [
          { id: 5, request: 'Build auth system', investigated: 'OAuth patterns', project: 'proj-b', created_at_epoch: 4000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('summary');
      expect(result[0].title).toBe('Build auth system');
      expect(result[0].snippet).toBe('OAuth patterns');
    });

    it('should use "Session #id" for summaries without request', () => {
      const data: SearchResponse = {
        summaries: [
          { id: 42, investigated: 'stuff', project: 'proj', created_at_epoch: 2000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result[0].title).toBe('Session #42');
    });

    it('should fall back to completed for summary snippet', () => {
      const data: SearchResponse = {
        summaries: [
          { id: 1, request: 'Req', completed: 'Done stuff', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result[0].snippet).toBe('Done stuff');
    });

    it('should normalize prompts from legacy format', () => {
      const data: SearchResponse = {
        prompts: [
          { id: 20, prompt_number: 3, prompt_text: 'help me debug', project: 'proj-c', created_at_epoch: 6000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('prompt');
      expect(result[0].title).toBe('Prompt #3');
      expect(result[0].snippet).toBe('help me debug');
    });

    it('should fall back to id when prompt_number is missing', () => {
      const data: SearchResponse = {
        prompts: [
          { id: 20, prompt_text: 'text', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result[0].title).toBe('Prompt #20');
    });

    it('should combine all legacy types and sort by recency', () => {
      const data: SearchResponse = {
        observations: [
          { id: 1, title: 'Obs', narrative: 'n', project: 'proj', created_at_epoch: 2000 },
        ],
        summaries: [
          { id: 2, request: 'Sum', investigated: 'i', project: 'proj', created_at_epoch: 4000 },
        ],
        prompts: [
          { id: 3, prompt_number: 1, prompt_text: 'p', project: 'proj', created_at_epoch: 1000 },
        ],
      };
      const result = normalizeSearchResults(data);
      expect(result).toHaveLength(3);
      // Sorted descending by epoch
      expect(result[0].type).toBe('summary');
      expect(result[1].type).toBe('observation');
      expect(result[2].type).toBe('prompt');
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty response', () => {
      const result = normalizeSearchResults({});
      expect(result).toEqual([]);
    });

    it('should handle empty arrays in legacy format', () => {
      const data: SearchResponse = {
        observations: [],
        summaries: [],
        prompts: [],
      };
      const result = normalizeSearchResults(data);
      expect(result).toEqual([]);
    });

    it('should prefer unified results over legacy format', () => {
      const data: SearchResponse = {
        results: [
          { id: 1, type: 'observation', title: 'Unified', snippet: '', project: 'proj', created_at_epoch: 1000 },
        ],
        observations: [
          { id: 2, title: 'Legacy', narrative: '', project: 'proj', created_at_epoch: 2000 },
        ],
      };
      const result = normalizeSearchResults(data);
      // Should only have the unified result (legacy is ignored when results exists)
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Unified');
    });
  });
});
