import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { DiaryService } from '../../../diary/DiaryService.js';

export class DiaryRoutes extends BaseRouteHandler {
  constructor(private diaryService: DiaryService) {
    super();
  }

  setupRoutes(app: Application): void {
    app.post('/api/diary', this.wrapHandler(this.handleAdd.bind(this)));
    app.get('/api/diary', this.wrapHandler(this.handleList.bind(this)));
    app.get('/api/diary/latest', this.wrapHandler(this.handleLatest.bind(this)));
    app.get('/api/diary/session/:sessionId', this.wrapHandler(this.handleBySession.bind(this)));
  }

  private handleAdd(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['entry'])) return;
    const id = this.diaryService.addEntry(
      req.body.sessionId || null,
      req.body.project || null,
      req.body.entry
    );
    res.json({ id });
  }

  private handleList(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const entries = this.diaryService.getRecentEntries(project, limit);
    res.json(entries);
  }

  private handleLatest(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const entry = this.diaryService.getLatestEntry(project);
    res.json(entry);
  }

  private handleBySession(req: Request, res: Response): void {
    const entries = this.diaryService.getEntriesBySession(req.params.sessionId);
    res.json(entries);
  }
}
