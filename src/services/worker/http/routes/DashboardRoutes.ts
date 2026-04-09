/**
 * Dashboard Routes
 *
 * HTTP API for memory health dashboard metrics.
 * Provides aggregated statistics about observations, concepts, freshness, and
 * supplementary knowledge stores for a given project.
 *
 * GET /api/dashboard?project=<name>   — full dashboard data
 * GET /api/dashboard/summary?project=<name> — lightweight summary (total + freshness)
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { DashboardService } from '../../../dashboard/DashboardService.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

export class DashboardRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/dashboard', this.wrapHandler(this.handleGetDashboard.bind(this)));
    app.get('/api/dashboard/summary', this.wrapHandler(this.handleGetSummary.bind(this)));
  }

  /**
   * Full dashboard data for a project.
   * GET /api/dashboard?project=my-project
   *
   * Returns all memory health metrics: totals, type distribution,
   * top concepts, freshness bands, and supplementary table counts.
   */
  private handleGetDashboard(req: Request, res: Response): void {
    const project = req.query.project as string | undefined;

    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }

    const db = this.dbManager.getSessionStore().db;
    const service = new DashboardService(db);

    try {
      const data = service.getDashboard(project);
      res.json(data);
    } catch (error) {
      logger.error('DASHBOARD', 'Failed to compute dashboard metrics', { project }, error as Error);
      throw error;
    }
  }

  /**
   * Lightweight summary for quick health checks.
   * GET /api/dashboard/summary?project=my-project
   *
   * Returns only totalObservations, thisWeekNew, and freshness distribution.
   */
  private handleGetSummary(req: Request, res: Response): void {
    const project = req.query.project as string | undefined;

    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }

    const db = this.dbManager.getSessionStore().db;
    const service = new DashboardService(db);

    try {
      const data = service.getDashboard(project);
      res.json({
        totalObservations: data.totalObservations,
        thisWeekNew: data.thisWeekNew,
        freshness: data.freshness,
      });
    } catch (error) {
      logger.error('DASHBOARD', 'Failed to compute dashboard summary', { project }, error as Error);
      throw error;
    }
  }
}
