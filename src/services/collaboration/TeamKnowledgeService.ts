/**
 * TeamKnowledgeService - Shared knowledge pages for team collaboration
 *
 * Allows users to share compiled knowledge pages with team members,
 * and import shared knowledge into local compiled_knowledge.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface SharedKnowledge {
  id: number;
  topic: string;
  content: string;
  sharedBy: string;
  project: string;
  sharedAt: string;
}

export class TeamKnowledgeService {
  constructor(private db: Database) {}

  /**
   * Share a compiled knowledge page with the team.
   * Copies from compiled_knowledge to shared_knowledge table.
   * Returns the shared knowledge ID.
   */
  shareKnowledge(compiledKnowledgeId: number, sharedBy: string): number {
    const ck = this.db.prepare(
      'SELECT topic, content, project FROM compiled_knowledge WHERE id = ?'
    ).get(compiledKnowledgeId) as { topic: string; content: string; project: string } | undefined;

    if (!ck) {
      throw new Error(`Compiled knowledge #${compiledKnowledgeId} not found`);
    }

    const result = this.db.prepare(`
      INSERT INTO shared_knowledge (topic, content, shared_by, project)
      VALUES (?, ?, ?, ?)
    `).run(ck.topic, ck.content, sharedBy, ck.project);

    const sharedId = Number(result.lastInsertRowid);
    logger.debug('TEAM', `Shared compiled knowledge #${compiledKnowledgeId} as shared #${sharedId} by ${sharedBy}`);
    return sharedId;
  }

  /**
   * Get all shared knowledge for a project.
   */
  getSharedKnowledge(project: string): SharedKnowledge[] {
    const rows = this.db.prepare(`
      SELECT id, topic, content, shared_by, project, shared_at
      FROM shared_knowledge
      WHERE project = ?
      ORDER BY shared_at DESC
    `).all(project) as any[];

    return rows.map(row => ({
      id: row.id,
      topic: row.topic,
      content: row.content,
      sharedBy: row.shared_by,
      project: row.project,
      sharedAt: row.shared_at,
    }));
  }

  /**
   * Import a shared knowledge page into local compiled_knowledge.
   * Returns the new compiled knowledge ID.
   */
  importShared(sharedKnowledge: SharedKnowledge): number {
    const result = this.db.prepare(`
      INSERT INTO compiled_knowledge (project, topic, content, confidence, compiled_at, created_at)
      VALUES (?, ?, ?, 'medium', datetime('now'), datetime('now'))
    `).run(sharedKnowledge.project, sharedKnowledge.topic, sharedKnowledge.content);

    const newId = Number(result.lastInsertRowid);
    logger.debug('TEAM', `Imported shared knowledge #${sharedKnowledge.id} as compiled #${newId}`);
    return newId;
  }
}
