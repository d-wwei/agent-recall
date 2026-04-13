import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { BackupService } from '../../../backup/BackupService.js';

export class BackupRoutes extends BaseRouteHandler {
  constructor(private backupService: BackupService) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/backup/list', this.wrapHandler(this.handleList.bind(this)));
    app.get('/api/backup/latest', this.wrapHandler(this.handleLatest.bind(this)));
    app.post('/api/backup/create', this.wrapHandler(this.handleCreate.bind(this)));
    app.post('/api/backup/restore', this.wrapHandler(this.handleRestore.bind(this)));
    app.post('/api/backup/prune', this.wrapHandler(this.handlePrune.bind(this)));
  }

  private handleList(_req: Request, res: Response): void {
    const backups = this.backupService.listBackups();
    res.json(backups);
  }

  private handleLatest(_req: Request, res: Response): void {
    const backup = this.backupService.getLatestBackup();
    res.json(backup);
  }

  private handleCreate(_req: Request, res: Response): void {
    const info = this.backupService.createBackup();
    res.json(info);
  }

  private handleRestore(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['backupPath'])) return;
    this.backupService.restoreBackup(req.body.backupPath);
    res.json({ success: true });
  }

  private handlePrune(req: Request, res: Response): void {
    const keepDays = req.body.keepDays ?? 7;
    const deleted = this.backupService.pruneOldBackups(keepDays);
    res.json({ deleted });
  }
}
