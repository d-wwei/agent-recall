/**
 * DoctorRoutes — Health audit API endpoints
 *
 * GET /api/doctor         — full audit (runs all 16 expectations, stores report)
 * GET /api/doctor/quick   — CRITICAL-only quick check (no DB write)
 * GET /api/doctor/history — historical reports with optional ?days=N
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { DoctorService } from '../../../doctor/DoctorService.js';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { logger } from '../../../../utils/logger.js';

export class DoctorRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/doctor', this.wrapHandler(this.handleFull.bind(this)));
    app.get('/api/doctor/quick', this.wrapHandler(this.handleQuick.bind(this)));
    app.get('/api/doctor/deep', this.wrapHandler(this.handleDeep.bind(this)));
    app.get('/api/doctor/history', this.wrapHandler(this.handleHistory.bind(this)));
  }

  private handleFull(_req: Request, res: Response): void {
    try {
      logger.info('DOCTOR', 'Running full audit');
      const db = this.dbManager.getSessionStore().db;
      const service = new DoctorService(db);
      const report = service.runFull();
      res.json(report);
    } catch (err) {
      logger.error('DOCTOR', 'Full audit failed', {}, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  }

  private handleDeep(_req: Request, res: Response): void {
    try {
      logger.info('DOCTOR', 'Running deep audit');
      const db = this.dbManager.getSessionStore().db;
      const service = new DoctorService(db);
      const report = service.runDeep();
      res.json(report);
    } catch (err) {
      logger.error('DOCTOR', 'Deep audit failed', {}, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  }

  private handleQuick(_req: Request, res: Response): void {
    try {
      const db = this.dbManager.getSessionStore().db;
      const service = new DoctorService(db);
      const report = service.runQuick();
      res.json(report);
    } catch (err) {
      logger.error('DOCTOR', 'Quick check failed', {}, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  }

  private handleHistory(req: Request, res: Response): void {
    try {
      const db = this.dbManager.getSessionStore().db;
      const service = new DoctorService(db);
      const days = Math.max(1, Math.min(parseInt(req.query.days as string, 10) || 30, 365));
      const history = service.getHistory(days);
      res.json({ entries: history, days });
    } catch (err) {
      logger.error('DOCTOR', 'History query failed', {}, err as Error);
      res.status(500).json({ error: (err as Error).message });
    }
  }
}
