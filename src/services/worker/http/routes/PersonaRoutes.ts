/**
 * PersonaRoutes - HTTP API for Agent Recall persona, bootstrap, and recovery
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { PersonaService } from '../../../persona/PersonaService.js';

export class PersonaRoutes extends BaseRouteHandler {
  constructor(private personaService: PersonaService) {
    super();
  }

  setupRoutes(app: express.Application): void {
    // Persona endpoints
    app.get('/api/persona', this.handleGetMergedPersona.bind(this));
    app.get('/api/persona/profile', this.handleGetProfile.bind(this));
    app.post('/api/persona/profile', this.handleSetProfile.bind(this));

    // Bootstrap endpoints
    app.get('/api/bootstrap/status', this.handleGetBootstrapStatus.bind(this));
    app.post('/api/bootstrap/update', this.handleUpdateBootstrapStatus.bind(this));

    // Recovery endpoints
    app.get('/api/recovery/active-task', this.handleGetActiveTask.bind(this));
    app.post('/api/recovery/active-task', this.handleSetActiveTask.bind(this));
    app.post('/api/recovery/complete-task', this.handleCompleteTask.bind(this));
    app.post('/api/recovery/update-task', this.handleUpdateTask.bind(this));
  }

  // ==========================================
  // Persona
  // ==========================================

  private handleGetMergedPersona = this.wrapHandler((req: Request, res: Response): void => {
    const project = (req.query.project as string) || '';
    const persona = this.personaService.getMergedPersona(project);
    res.json(persona);
  });

  private handleGetProfile = this.wrapHandler((req: Request, res: Response): void => {
    const scope = req.query.scope as string;
    const type = req.query.type as string;
    if (!scope || !type) {
      this.badRequest(res, 'scope and type are required');
      return;
    }
    const profile = this.personaService.getProfile(scope, type as any);
    res.json(profile || {});
  });

  private handleSetProfile = this.wrapHandler((req: Request, res: Response): void => {
    const { scope, type, content } = req.body;
    if (!scope || !type || !content) {
      this.badRequest(res, 'scope, type, and content are required');
      return;
    }
    this.personaService.setProfile(scope, type, content);
    res.json({ ok: true });
  });

  // ==========================================
  // Bootstrap
  // ==========================================

  private handleGetBootstrapStatus = this.wrapHandler((req: Request, res: Response): void => {
    const scope = (req.query.scope as string) || '__global__';
    const state = this.personaService.getBootstrapStatus(scope);
    res.json(state || { scope, status: 'pending', round: 0 });
  });

  private handleUpdateBootstrapStatus = this.wrapHandler((req: Request, res: Response): void => {
    const { scope, status, round, metadata } = req.body;
    if (!scope || !status) {
      this.badRequest(res, 'scope and status are required');
      return;
    }
    this.personaService.updateBootstrapStatus(scope, status, round, metadata);
    res.json({ ok: true });
  });

  // ==========================================
  // Recovery
  // ==========================================

  private handleGetActiveTask = this.wrapHandler((req: Request, res: Response): void => {
    const project = (req.query.project as string) || '';
    const task = this.personaService.getActiveTask(project);
    res.json(task || null);
  });

  private handleSetActiveTask = this.wrapHandler((req: Request, res: Response): void => {
    const { project, task_name, status, progress, next_step, context_json, interrupted_tasks_json } = req.body;
    if (!project || !task_name) {
      this.badRequest(res, 'project and task_name are required');
      return;
    }
    this.personaService.setActiveTask(project, {
      task_name, status, progress, next_step, context_json, interrupted_tasks_json
    });
    res.json({ ok: true });
  });

  private handleCompleteTask = this.wrapHandler((req: Request, res: Response): void => {
    const { project } = req.body;
    if (!project) {
      this.badRequest(res, 'project is required');
      return;
    }
    this.personaService.completeActiveTask(project);
    res.json({ ok: true });
  });

  private handleUpdateTask = this.wrapHandler((req: Request, res: Response): void => {
    const { project, status, progress, next_step, context_json, interrupted_tasks_json } = req.body;
    if (!project) {
      this.badRequest(res, 'project is required');
      return;
    }
    this.personaService.updateActiveTask(project, {
      status, progress, next_step, context_json, interrupted_tasks_json
    });
    res.json({ ok: true });
  });
}
