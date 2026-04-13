import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { MarkdownExporter } from '../../../markdown-sync/MarkdownExporter.js';
import type { MarkdownImporter } from '../../../markdown-sync/MarkdownImporter.js';

export class MarkdownSyncRoutes extends BaseRouteHandler {
  constructor(
    private exporter: MarkdownExporter,
    private importer: MarkdownImporter
  ) {
    super();
  }

  setupRoutes(app: Application): void {
    app.post('/api/markdown-sync/export', this.wrapHandler(this.handleExport.bind(this)));
    app.get('/api/markdown-sync/changes', this.wrapHandler(this.handleChanges.bind(this)));
    app.post('/api/markdown-sync/import', this.wrapHandler(this.handleImport.bind(this)));
    app.get('/api/markdown-sync/status', this.wrapHandler(this.handleStatus.bind(this)));
  }

  private handleExport(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['project'])) return;
    const filesWritten = this.exporter.exportAll(req.body.project);
    res.json({ filesWritten });
  }

  private handleChanges(_req: Request, res: Response): void {
    const changes = this.importer.checkForChanges();
    res.json(changes);
  }

  private handleImport(_req: Request, res: Response): void {
    const changes = this.importer.checkForChanges();
    const imported = this.importer.importChanges(changes);
    res.json({ imported });
  }

  private handleStatus(_req: Request, res: Response): void {
    const changes = this.importer.checkForChanges();
    res.json({ pendingChanges: changes.length, changes });
  }
}
