/**
 * ArchiveRoutes - HTTP API for session archiving and recall
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { logger } from '../../../../utils/logger.js';
import type { SessionArchiveService } from '../../../archiving/SessionArchiveService.js';
import type { PromotionService } from '../../../promotion/PromotionService.js';

export class ArchiveRoutes extends BaseRouteHandler {
  constructor(
    private archiveService: SessionArchiveService,
    private promotionService: PromotionService
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    // Archive endpoints
    app.get('/api/archives', this.handleGetArchives.bind(this));
    app.get('/api/archives/search', this.handleSearchArchives.bind(this));
    app.get('/api/archives/temporal', this.handleTemporalRecall.bind(this));
    app.post('/api/archives', this.handleCreateArchive.bind(this));

    // Promotion endpoints
    app.get('/api/promotion/detect', this.handleDetectPromotable.bind(this));
    app.post('/api/promotion/sync', this.handlePromote.bind(this));
    app.get('/api/promotion/policy', this.handleGetPolicy.bind(this));
    app.post('/api/promotion/policy', this.handleSetPolicy.bind(this));
    app.get('/api/promotion/history', this.handlePromotionHistory.bind(this));
  }

  // Archive handlers
  private handleGetArchives = this.wrapHandler((req: Request, res: Response): void => {
    const project = req.query.project as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    res.json(this.archiveService.getRecentArchives(project, limit));
  });

  private handleSearchArchives = this.wrapHandler((req: Request, res: Response): void => {
    const query = req.query.query as string;
    const project = req.query.project as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    if (!query) { this.badRequest(res, 'query is required'); return; }
    res.json(this.archiveService.recallByTopic(query, project, limit));
  });

  private handleTemporalRecall = this.wrapHandler((req: Request, res: Response): void => {
    const from = parseInt(req.query.from as string);
    const to = parseInt(req.query.to as string) || Date.now();
    const project = req.query.project as string | undefined;
    if (isNaN(from)) { this.badRequest(res, 'from (epoch ms) is required'); return; }
    res.json(this.archiveService.recallByTime(from, to, project));
  });

  private handleCreateArchive = this.wrapHandler((req: Request, res: Response): void => {
    const { project, summary, memory_session_id, key_outcomes, files_changed, tags, duration_minutes } = req.body;
    if (!project || !summary) { this.badRequest(res, 'project and summary are required'); return; }
    const id = this.archiveService.archive({ project, summary, memory_session_id, key_outcomes, files_changed, tags, duration_minutes });
    res.json({ ok: true, id });
  });

  // Promotion handlers
  private handleDetectPromotable = this.wrapHandler((req: Request, res: Response): void => {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project is required'); return; }
    res.json(this.promotionService.detectPromotable(project));
  });

  private handlePromote = this.wrapHandler((req: Request, res: Response): void => {
    const { observation_id } = req.body;
    if (!observation_id) { this.badRequest(res, 'observation_id is required'); return; }
    this.promotionService.promoteObservation(observation_id);
    res.json({ ok: true });
  });

  private handleGetPolicy = this.wrapHandler((req: Request, res: Response): void => {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project is required'); return; }
    res.json(this.promotionService.getSyncPolicy(project));
  });

  private handleSetPolicy = this.wrapHandler((req: Request, res: Response): void => {
    const { project, action } = req.body;
    if (!project || !action) { this.badRequest(res, 'project and action are required'); return; }
    this.promotionService.setSyncPolicy(project, action);
    res.json({ ok: true });
  });

  private handlePromotionHistory = this.wrapHandler((req: Request, res: Response): void => {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(this.promotionService.getPromotionHistory(limit));
  });
}
