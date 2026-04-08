/**
 * TemplateRoutes - HTTP API for reusable text template CRUD
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { TemplateService } from '../../../template/TemplateService.js';

export class TemplateRoutes extends BaseRouteHandler {
  constructor(private templateService: TemplateService) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/templates', this.handleList.bind(this));
    app.get('/api/templates/:name', this.handleGet.bind(this));
    app.post('/api/templates', this.handleCreate.bind(this));
    app.put('/api/templates/:name', this.handleUpdate.bind(this));
    app.delete('/api/templates/:name', this.handleDelete.bind(this));
  }

  /**
   * GET /api/templates?scope=...&category=...
   */
  private handleList = this.wrapHandler((req: Request, res: Response): void => {
    const scope = req.query.scope as string | undefined;
    const category = req.query.category as string | undefined;
    res.json(this.templateService.list(scope, category));
  });

  /**
   * GET /api/templates/:name?scope=global
   */
  private handleGet = this.wrapHandler((req: Request, res: Response): void => {
    const name = req.params.name;
    const scope = (req.query.scope as string) || 'global';
    const template = this.templateService.get(scope, name);
    if (!template) {
      this.notFound(res, `Template "${name}" not found in scope "${scope}"`);
      return;
    }
    res.json(template);
  });

  /**
   * POST /api/templates
   * Body: { name, content, scope?, category?, description? }
   */
  private handleCreate = this.wrapHandler((req: Request, res: Response): void => {
    const { name, content, scope, category, description } = req.body;
    if (!name || !content) {
      this.badRequest(res, 'name and content are required');
      return;
    }
    try {
      const template = this.templateService.create({ name, content, scope, category, description });
      res.status(201).json(template);
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint failed')) {
        res.status(409).json({ error: `Template "${name}" already exists in scope "${scope || 'global'}"` });
        return;
      }
      throw error;
    }
  });

  /**
   * PUT /api/templates/:name
   * Body: { content?, category?, description?, scope? }
   */
  private handleUpdate = this.wrapHandler((req: Request, res: Response): void => {
    const name = req.params.name;
    const { content, category, description, scope } = req.body;
    const targetScope = scope || 'global';
    const updated = this.templateService.update(targetScope, name, { content, category, description });
    if (!updated) {
      this.notFound(res, `Template "${name}" not found in scope "${targetScope}"`);
      return;
    }
    res.json(updated);
  });

  /**
   * DELETE /api/templates/:name?scope=global
   */
  private handleDelete = this.wrapHandler((req: Request, res: Response): void => {
    const name = req.params.name;
    const scope = (req.query.scope as string) || 'global';
    const deleted = this.templateService.delete(scope, name);
    if (!deleted) {
      this.notFound(res, `Template "${name}" not found in scope "${scope}"`);
      return;
    }
    res.json({ ok: true });
  });
}
