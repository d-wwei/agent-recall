/**
 * TemplateService - CRUD and merge logic for reusable text templates
 *
 * Supports global and project-scoped templates with category filtering.
 * Project templates override global templates with the same name.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface Template {
  id: number;
  name: string;
  scope: string;
  category: string | null;
  content: string;
  description: string | null;
  created_at: string;
  created_at_epoch: number;
  updated_at: string | null;
  updated_at_epoch: number | null;
}

export interface CreateTemplateInput {
  name: string;
  scope?: string;
  category?: string;
  content: string;
  description?: string;
}

export interface UpdateTemplateInput {
  content?: string;
  category?: string;
  description?: string;
}

export class TemplateService {
  constructor(private db: Database) {}

  /**
   * List all templates, optionally filtered by scope and/or category
   */
  list(scope?: string, category?: string): Template[] {
    let sql = 'SELECT * FROM templates WHERE 1=1';
    const params: any[] = [];

    if (scope) {
      sql += ' AND scope = ?';
      params.push(scope);
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY scope, name';
    return this.db.prepare(sql).all(...params) as Template[];
  }

  /**
   * Get a single template by scope + name (unique index)
   */
  get(scope: string, name: string): Template | null {
    const row = this.db.prepare(
      'SELECT * FROM templates WHERE scope = ? AND name = ?'
    ).get(scope, name) as Template | undefined;
    return row ?? null;
  }

  /**
   * Create a new template
   */
  create(data: CreateTemplateInput): Template {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    const scope = data.scope || 'global';

    this.db.prepare(`
      INSERT INTO templates (name, scope, category, content, description, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(data.name, scope, data.category ?? null, data.content, data.description ?? null, now, nowEpoch);

    logger.debug('TEMPLATE', `Created template "${data.name}" in scope "${scope}"`);
    return this.get(scope, data.name)!;
  }

  /**
   * Update an existing template's content, category, or description
   */
  update(scope: string, name: string, updates: UpdateTemplateInput): Template | null {
    const existing = this.get(scope, name);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    const newContent = updates.content !== undefined ? updates.content : existing.content;
    const newCategory = updates.category !== undefined ? updates.category : existing.category;
    const newDescription = updates.description !== undefined ? updates.description : existing.description;

    this.db.prepare(`
      UPDATE templates
      SET content = ?, category = ?, description = ?, updated_at = ?, updated_at_epoch = ?
      WHERE scope = ? AND name = ?
    `).run(newContent, newCategory, newDescription, now, nowEpoch, scope, name);

    logger.debug('TEMPLATE', `Updated template "${name}" in scope "${scope}"`);
    return this.get(scope, name);
  }

  /**
   * Delete a template by scope + name. Returns true if a row was deleted.
   */
  delete(scope: string, name: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM templates WHERE scope = ? AND name = ?'
    ).run(scope, name);
    const deleted = result.changes > 0;
    if (deleted) {
      logger.debug('TEMPLATE', `Deleted template "${name}" from scope "${scope}"`);
    }
    return deleted;
  }

  /**
   * Get templates for a project: returns project-scoped + global templates,
   * with project templates overriding global ones by name.
   */
  getForProject(project: string): Template[] {
    const globalTemplates = this.list('global');
    const projectTemplates = this.list(project);

    // Build map: project templates override global by name
    const merged = new Map<string, Template>();
    for (const t of globalTemplates) {
      merged.set(t.name, t);
    }
    for (const t of projectTemplates) {
      merged.set(t.name, t);
    }

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Insert default templates if they don't already exist.
   * Uses INSERT OR IGNORE for idempotency.
   */
  static ensureDefaults(db: Database): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    const defaults: Array<{ name: string; category: string; content: string; description: string }> = [
      {
        name: 'weekly-report',
        category: 'report',
        content: [
          '# Weekly Progress Report',
          '',
          '## Period: [Start Date] - [End Date]',
          '',
          '## Completed',
          '- ',
          '',
          '## In Progress',
          '- ',
          '',
          '## Blocked',
          '- ',
          '',
          '## Next Week',
          '- ',
        ].join('\n'),
        description: 'Basic weekly progress report structure',
      },
      {
        name: 'meeting-notes',
        category: 'meeting',
        content: [
          '# Meeting Notes',
          '',
          '**Date:** [Date]',
          '**Attendees:** [Names]',
          '',
          '## Agenda',
          '1. ',
          '',
          '## Discussion',
          '- ',
          '',
          '## Action Items',
          '- [ ] ',
          '',
          '## Decisions',
          '- ',
        ].join('\n'),
        description: 'Meeting notes template with agenda, discussion, and action items',
      },
      {
        name: 'session-handoff',
        category: 'report',
        content: [
          '# Session Handoff',
          '',
          '## What was done',
          '- ',
          '',
          '## Current state',
          '- ',
          '',
          '## Next steps',
          '- ',
          '',
          '## Blockers',
          '- ',
        ].join('\n'),
        description: 'Session handoff/summary template for cross-session continuity',
      },
    ];

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO templates (name, scope, category, content, description, created_at, created_at_epoch)
      VALUES (?, 'global', ?, ?, ?, ?, ?)
    `);

    for (const d of defaults) {
      stmt.run(d.name, d.category, d.content, d.description, now, nowEpoch);
    }

    logger.debug('TEMPLATE', 'Default templates ensured');
  }
}
