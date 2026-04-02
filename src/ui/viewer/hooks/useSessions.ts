import { useState, useEffect, useCallback } from 'react';

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

export function useSessions(projectFilter: string) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (projectFilter) params.append('project', projectFilter);

      const response = await fetch(`/api/search/sessions?${params}`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json() as any;

      // The API may return different formats, normalize
      const items: SessionItem[] = Array.isArray(data) ? data :
        (data.sessions || data.results || data.items || []);

      setSessions(items);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return { sessions, isLoading, refresh: fetchSessions };
}
