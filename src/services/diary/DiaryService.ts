import { Database } from 'bun:sqlite';

export interface DiaryEntry {
  id: number;
  memory_session_id: string | null;
  project: string | null;
  entry: string;
  created_at: string;
}

export class DiaryService {
  constructor(private db: Database) {}

  addEntry(sessionId: string | null, project: string | null, entry: string): number {
    const result = this.db.prepare(
      'INSERT INTO agent_diary (memory_session_id, project, entry) VALUES (?, ?, ?)'
    ).run(sessionId, project, entry);
    return Number(result.lastInsertRowid);
  }

  getRecentEntries(project: string, limit: number = 5): DiaryEntry[] {
    return this.db.prepare(
      'SELECT * FROM agent_diary WHERE project = ? ORDER BY created_at DESC LIMIT ?'
    ).all(project, limit) as DiaryEntry[];
  }

  getLatestEntry(project: string): DiaryEntry | null {
    return this.db.prepare(
      'SELECT * FROM agent_diary WHERE project = ? ORDER BY created_at DESC LIMIT 1'
    ).get(project) as DiaryEntry | null;
  }

  getEntriesBySession(sessionId: string): DiaryEntry[] {
    return this.db.prepare(
      'SELECT * FROM agent_diary WHERE memory_session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as DiaryEntry[];
  }
}
