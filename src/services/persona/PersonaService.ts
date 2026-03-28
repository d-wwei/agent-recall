/**
 * PersonaService - CRUD and merge logic for Agent Recall persona system
 *
 * Handles agent_profiles, bootstrap_state, and active_tasks tables.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import type {
  ProfileType,
  ProfileScope,
  AgentProfileRow,
  MergedPersona,
  AgentSoulProfile,
  UserProfile,
  StyleProfile,
  WorkflowProfile,
  BootstrapStateRow,
  ActiveTaskRow
} from './PersonaTypes.js';

export class PersonaService {
  constructor(private db: Database) {}

  // ==========================================
  // Agent Profiles
  // ==========================================

  getProfile(scope: ProfileScope, profileType: ProfileType): Record<string, any> | null {
    const row = this.db.prepare(
      'SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = ?'
    ).get(scope, profileType) as { content_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.content_json);
    } catch {
      return null;
    }
  }

  setProfile(scope: ProfileScope, profileType: ProfileType, content: Record<string, any>): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    const contentJson = JSON.stringify(content);

    // Upsert using INSERT OR REPLACE with the unique index
    this.db.prepare(`
      INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run(scope, profileType, contentJson, now, nowEpoch, now, nowEpoch);

    logger.debug('PERSONA', `Set ${profileType} profile for scope: ${scope}`);
  }

  /**
   * Merge global + project persona. Project overrides global for non-empty fields.
   */
  getMergedPersona(project: string): MergedPersona {
    const types: ProfileType[] = ['agent_soul', 'user', 'style', 'workflow'];
    const merged: Record<string, Record<string, any>> = {};

    for (const type of types) {
      const globalProfile = this.getProfile('global', type) || {};
      const projectProfile = project ? (this.getProfile(project, type) || {}) : {};

      // Merge: project overrides global for non-null, non-empty fields
      merged[type] = { ...globalProfile };
      for (const [key, value] of Object.entries(projectProfile)) {
        if (value !== null && value !== undefined && value !== '') {
          merged[type][key] = value;
        }
      }
    }

    return merged as unknown as MergedPersona;
  }

  // ==========================================
  // Bootstrap State
  // ==========================================

  getBootstrapStatus(scope: string): BootstrapStateRow | null {
    return (this.db.prepare(
      'SELECT * FROM bootstrap_state WHERE scope = ?'
    ).get(scope) as BootstrapStateRow | undefined) || null;
  }

  updateBootstrapStatus(
    scope: string,
    status: 'pending' | 'in_progress' | 'completed',
    round?: number,
    metadata?: Record<string, any>
  ): void {
    const now = new Date().toISOString();

    const existing = this.getBootstrapStatus(scope);
    if (existing) {
      const updates: string[] = ['status = ?'];
      const params: any[] = [status];

      if (round !== undefined) {
        updates.push('round = ?');
        params.push(round);
      }
      if (metadata) {
        updates.push('metadata_json = ?');
        params.push(JSON.stringify(metadata));
      }
      if (status === 'completed') {
        updates.push('completed_at = ?');
        params.push(now);
      }

      params.push(scope);
      this.db.prepare(`UPDATE bootstrap_state SET ${updates.join(', ')} WHERE scope = ?`).run(...params);
    } else {
      this.db.prepare(`
        INSERT INTO bootstrap_state (scope, status, round, started_at, metadata_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(scope, status, round || 0, now, metadata ? JSON.stringify(metadata) : null);
    }

    logger.debug('PERSONA', `Bootstrap status for ${scope}: ${status}`);
  }

  // ==========================================
  // Active Tasks
  // ==========================================

  getActiveTask(project: string): ActiveTaskRow | null {
    return (this.db.prepare(
      "SELECT * FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1"
    ).get(project) as ActiveTaskRow | undefined) || null;
  }

  setActiveTask(project: string, data: {
    task_name: string;
    status?: string;
    progress?: string;
    next_step?: string;
    context_json?: Record<string, any>;
    interrupted_tasks_json?: Array<Record<string, any>>;
  }): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    // Complete any existing active task for this project first
    this.db.prepare(
      "UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')"
    ).run(now, nowEpoch, project);

    // Insert new task
    this.db.prepare(`
      INSERT INTO active_tasks (project, task_name, status, progress, next_step, context_json, interrupted_tasks_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project,
      data.task_name,
      data.status || 'in_progress',
      data.progress || null,
      data.next_step || null,
      data.context_json ? JSON.stringify(data.context_json) : null,
      data.interrupted_tasks_json ? JSON.stringify(data.interrupted_tasks_json) : null,
      now, nowEpoch, now, nowEpoch
    );

    logger.debug('PERSONA', `Set active task for ${project}: ${data.task_name}`);
  }

  updateActiveTask(project: string, updates: {
    status?: string;
    progress?: string;
    next_step?: string;
    context_json?: Record<string, any>;
    interrupted_tasks_json?: Array<Record<string, any>>;
  }): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    const setClauses: string[] = ['updated_at = ?', 'updated_at_epoch = ?'];
    const params: any[] = [now, nowEpoch];

    if (updates.status) { setClauses.push('status = ?'); params.push(updates.status); }
    if (updates.progress) { setClauses.push('progress = ?'); params.push(updates.progress); }
    if (updates.next_step) { setClauses.push('next_step = ?'); params.push(updates.next_step); }
    if (updates.context_json) { setClauses.push('context_json = ?'); params.push(JSON.stringify(updates.context_json)); }
    if (updates.interrupted_tasks_json) { setClauses.push('interrupted_tasks_json = ?'); params.push(JSON.stringify(updates.interrupted_tasks_json)); }

    params.push(project);
    this.db.prepare(
      `UPDATE active_tasks SET ${setClauses.join(', ')} WHERE project = ? AND status IN ('in_progress', 'blocked')`
    ).run(...params);
  }

  completeActiveTask(project: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    this.db.prepare(
      "UPDATE active_tasks SET status = 'completed', updated_at = ?, updated_at_epoch = ? WHERE project = ? AND status IN ('in_progress', 'blocked')"
    ).run(now, nowEpoch, project);
    logger.debug('PERSONA', `Completed active task for ${project}`);
  }
}
