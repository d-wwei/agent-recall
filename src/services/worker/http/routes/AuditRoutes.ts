/**
 * Audit Routes
 *
 * HTTP API for audit log queries, statistics, and memory review tracking.
 * All endpoints use direct database access via the DatabaseManager service layer.
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { AuditService } from '../../../audit/AuditService.js';
import { logger } from '../../../../utils/logger.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../../../shared/paths.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

export class AuditRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/audit/log', this.wrapHandler(this.handleGetLog.bind(this)));
    app.get('/api/audit/stats', this.wrapHandler(this.handleGetStats.bind(this)));
    app.post('/api/audit/review', this.wrapHandler(this.handleMarkReview.bind(this)));
    app.get('/api/audit/review-due', this.wrapHandler(this.handleReviewDue.bind(this)));
  }

  /**
   * Query audit log entries.
   * GET /api/audit/log
   * Query params: limit (default 50), offset (default 0), action (optional filter)
   */
  private handleGetLog(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const action = req.query.action as string | undefined;

    const entries = AuditService.getLog(db, { limit, offset, action });

    res.json({
      entries,
      limit,
      offset,
      count: entries.length,
    });
  }

  /**
   * Get audit statistics summary.
   * GET /api/audit/stats
   * Returns total entries, last review date, and counts grouped by action type.
   */
  private handleGetStats(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const stats = AuditService.getStats(db);
    res.json(stats);
  }

  /**
   * Mark memory review as completed.
   * POST /api/audit/review
   * Body: { date?: string } — optional ISO date string, defaults to now.
   */
  private handleMarkReview(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const date = req.body.date || new Date().toISOString();

    AuditService.setReviewDate(db, date);

    res.json({ ok: true, review_date: date });
  }

  /**
   * Check if a monthly memory review is due.
   * GET /api/audit/review-due
   * Returns { due: boolean, last_review: string | null, days_since_review: number | null }
   */
  private handleReviewDue(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const intervalDays = parseInt(settings.CLAUDE_MEM_AUDIT_REVIEW_INTERVAL_DAYS, 10) || 30;

    const lastReview = AuditService.getLastReviewDate(db);

    if (!lastReview) {
      res.json({
        due: true,
        last_review: null,
        days_since_review: null,
        interval_days: intervalDays,
      });
      return;
    }

    const lastReviewEpoch = new Date(lastReview).getTime();
    const daysSinceReview = Math.floor((Date.now() - lastReviewEpoch) / 86_400_000);
    const due = daysSinceReview > intervalDays;

    res.json({
      due,
      last_review: lastReview,
      days_since_review: daysSinceReview,
      interval_days: intervalDays,
    });
  }
}
