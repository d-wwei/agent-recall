/**
 * PersonaRoutes - HTTP API for Agent Recall persona, bootstrap, recovery, and project scan
 */

import express, { Request, Response } from 'express';
import { Database } from 'bun:sqlite';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { PersonaService } from '../../../persona/PersonaService.js';
import { ProjectScanService } from '../../../project/ProjectScanService.js';

export class PersonaRoutes extends BaseRouteHandler {
  private db: Database | null;

  constructor(personaService: PersonaService, db?: Database);
  constructor(private personaService: PersonaService, db?: Database) {
    super();
    this.db = db ?? null;
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

    // Checkpoint endpoints
    app.get('/api/recovery/checkpoints', this.wrapHandler(this.handleGetCheckpoints.bind(this)));
    app.post('/api/recovery/checkpoints', this.wrapHandler(this.handleSetCheckpoints.bind(this)));
    app.post('/api/recovery/checkpoint', this.wrapHandler(this.handleAddCheckpoint.bind(this)));
    app.post('/api/recovery/checkpoint/complete', this.wrapHandler(this.handleCompleteCheckpoint.bind(this)));

    // Project scan endpoint
    app.get('/api/projects/scan', this.wrapHandler(this.handleProjectScan.bind(this)));
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

  // ==========================================
  // Checkpoints
  // ==========================================

  private handleGetCheckpoints(req: Request, res: Response): void {
    const project = (req.query.project as string) || '';
    if (!project) {
      this.badRequest(res, 'project is required');
      return;
    }
    const checkpoints = this.personaService.getTaskCheckpoints(project);
    res.json(checkpoints);
  }

  private handleSetCheckpoints(req: Request, res: Response): void {
    const { project, checkpoints } = req.body;
    if (!project || !checkpoints) {
      this.badRequest(res, 'project and checkpoints are required');
      return;
    }
    this.personaService.setCheckpoints(project, checkpoints);
    res.json({ ok: true });
  }

  private handleAddCheckpoint(req: Request, res: Response): void {
    const { project, name } = req.body;
    if (!project || !name) {
      this.badRequest(res, 'project and name are required');
      return;
    }
    this.personaService.addCheckpoint(project, name);
    res.json({ ok: true });
  }

  private handleCompleteCheckpoint(req: Request, res: Response): void {
    const { project, name } = req.body;
    if (!project || !name) {
      this.badRequest(res, 'project and name are required');
      return;
    }
    this.personaService.completeCheckpoint(project, name);
    res.json({ ok: true });
  }

  // ==========================================
  // Project Scan
  // ==========================================

  private handleProjectScan(req: Request, res: Response): void {
    if (!this.db) {
      res.status(503).json({ error: 'Database not available for project scan' });
      return;
    }
    const scanService = new ProjectScanService(this.db);
    const results = scanService.scanProjects();
    res.json(results);
  }
}
