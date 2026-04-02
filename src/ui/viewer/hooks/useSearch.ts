import { useState, useCallback, useRef } from 'react';

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

export function useSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback((q: string) => {
    setQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ query: q, limit: '20' });
        const response = await fetch(`/api/search?${params}`);
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json() as SearchResponse;

        // Normalize results from the API response format
        const normalized: SearchResult[] = [];

        if (data.results) {
          // Unified format
          normalized.push(...data.results);
        } else {
          // Legacy format: separate arrays
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

        // Sort by recency
        normalized.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
        setResults(normalized);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setIsSearching(false);
  }, []);

  return { query, results, isSearching, search, clear };
}
