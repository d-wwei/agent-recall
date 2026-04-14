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

export class DoctorRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/doctor', this.wrapHandler(this.handleFull.bind(this)));
    app.get('/api/doctor/quick', this.wrapHandler(this.handleQuick.bind(this)));
    app.get('/api/doctor/history', this.wrapHandler(this.handleHistory.bind(this)));
  }

  private handleFull(_req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const service = new DoctorService(db);
    const report = service.runFull();
    res.json(report);
  }

  private handleQuick(_req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const service = new DoctorService(db);
    const report = service.runQuick();
    res.json(report);
  }

  private handleHistory(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const service = new DoctorService(db);
    const days = parseInt(req.query.days as string, 10) || 30;
    const history = service.getHistory(days);
    res.json({ entries: history, days });
  }
}
