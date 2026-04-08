/**
 * Cleanup Routes
 *
 * HTTP API for data retention lifecycle management.
 * Provides preview, execute, and stats endpoints for database cleanup.
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { DataRetentionService } from '../../../cleanup/DataRetentionService.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../../../shared/paths.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

export class CleanupRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/cleanup/preview', this.wrapHandler(this.handlePreview.bind(this)));
    app.post('/api/cleanup/execute', this.wrapHandler(this.handleExecute.bind(this)));
    app.get('/api/cleanup/stats', this.wrapHandler(this.handleStats.bind(this)));
  }

  /**
   * Preview what cleanup would delete without making changes.
   * GET /api/cleanup/preview
   * Optional query params: retentionDays, summaryRetentionDays
   */
  private handlePreview(req: Request, res: Response): void {
    const { retentionDays, summaryRetentionDays } = this.getRetentionSettings(req);
    const db = this.dbManager.getSessionStore().db;

    const preview = DataRetentionService.preview(db, retentionDays, summaryRetentionDays);

    res.json({
      ...preview,
      retention_days: retentionDays,
      summary_retention_days: summaryRetentionDays,
    });
  }

  /**
   * Execute cleanup operation.
   * POST /api/cleanup/execute
   * Optional query param: dryRun=true
   * Optional query params: retentionDays, summaryRetentionDays
   */
  private handleExecute(req: Request, res: Response): void {
    const { retentionDays, summaryRetentionDays } = this.getRetentionSettings(req);
    const dryRun = req.query.dryRun === 'true';
    const db = this.dbManager.getSessionStore().db;

    logger.info('CLEANUP', `Cleanup ${dryRun ? 'dry run' : 'execution'} requested`, {
      retentionDays,
      summaryRetentionDays,
      dryRun,
    });

    const result = DataRetentionService.execute(db, retentionDays, summaryRetentionDays, dryRun);

    res.json({
      ...result,
      retention_days: retentionDays,
      summary_retention_days: summaryRetentionDays,
    });
  }

  /**
   * Get current database statistics.
   * GET /api/cleanup/stats
   */
  private handleStats(req: Request, res: Response): void {
    const db = this.dbManager.getSessionStore().db;
    const stats = DataRetentionService.getStats(db);
    res.json(stats);
  }

  /**
   * Read retention settings from query params (override) or settings file.
   */
  private getRetentionSettings(req: Request): {
    retentionDays: number;
    summaryRetentionDays: number;
  } {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const retentionDays = req.query.retentionDays
      ? parseInt(req.query.retentionDays as string, 10)
      : parseInt(settings.CLAUDE_MEM_DATA_RETENTION_DAYS, 10);

    const summaryRetentionDays = req.query.summaryRetentionDays
      ? parseInt(req.query.summaryRetentionDays as string, 10)
      : parseInt(settings.CLAUDE_MEM_SUMMARY_RETENTION_DAYS, 10);

    return {
      retentionDays: isNaN(retentionDays) ? 90 : retentionDays,
      summaryRetentionDays: isNaN(summaryRetentionDays) ? 365 : summaryRetentionDays,
    };
  }
}
