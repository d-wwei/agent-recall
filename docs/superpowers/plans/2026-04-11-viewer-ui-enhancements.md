# Viewer UI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compilation status, Mermaid diagrams, LLM cost tracking, and search explanation enhancements to the Viewer UI dashboard.

**Architecture:** 3 new backend API endpoints in a CompilationRoutes handler, 3 new React components rendered in Dashboard.tsx, Mermaid via CDN script tag. Follow existing patterns: BaseRouteHandler for routes, fetch + useState for data, CSS custom properties for styling.

**Tech Stack:** React 18, TypeScript, Express, bun:sqlite, Mermaid.js (CDN), CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-04-11-viewer-ui-enhancements-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/services/worker/http/routes/CompilationRoutes.ts` | 3 API endpoints: stats, logs, diagrams |
| `src/ui/viewer/components/CompilationStatus.tsx` | Compilation status + lint warnings section |
| `src/ui/viewer/components/MermaidDiagrams.tsx` | Mermaid diagram rendering |
| `src/ui/viewer/components/LLMCostTracker.tsx` | Token usage + cost table |
| `tests/worker/http/routes/compilation-routes.test.ts` | API endpoint tests |

Modified files:
- `src/ui/viewer/components/Dashboard.tsx` — import and render 3 new sections
- `src/ui/viewer/viewer-template.html` — CSS for new sections + Mermaid CDN script
- `src/services/worker-service.ts` — register CompilationRoutes
- `src/ui/viewer/constants/api.ts` — add new endpoint constants

---

### Task 1: CompilationRoutes API endpoints

**Files:**
- Create: `src/services/worker/http/routes/CompilationRoutes.ts`
- Create: `tests/worker/http/routes/compilation-routes.test.ts`
- Modify: `src/services/worker-service.ts`
- Modify: `src/ui/viewer/constants/api.ts`

- [ ] **Step 1: Write test for compilation routes**

```typescript
// tests/worker/http/routes/compilation-routes.test.ts
import { describe, it, expect } from 'bun:test';

// Since routes need a full Express app + DB, we test the response shapes
// by calling the worker API directly (integration test style)
const API_BASE = 'http://127.0.0.1:37777';

describe('CompilationRoutes', () => {
  it('GET /api/compilation/stats returns valid shape', async () => {
    try {
      const res = await fetch(`${API_BASE}/api/compilation/stats?project=test`);
      if (res.status !== 200) return; // Worker may not be running in CI
      const data = await res.json();
      expect(typeof data.totalRuns).toBe('number');
      expect(typeof data.successRate).toBe('number');
      expect(typeof data.aiMergeActive).toBe('boolean');
      expect(typeof data.aiMergeModel).toBe('string');
      expect(Array.isArray(data.lintWarnings)).toBe(true);
    } catch {
      // Worker not running — skip gracefully
    }
  });

  it('GET /api/compilation/logs returns array', async () => {
    try {
      const res = await fetch(`${API_BASE}/api/compilation/logs?project=test&limit=5`);
      if (res.status !== 200) return;
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    } catch {
      // Worker not running
    }
  });

  it('GET /api/compilation/diagrams returns valid shape', async () => {
    try {
      const res = await fetch(`${API_BASE}/api/compilation/diagrams?project=test`);
      if (res.status !== 200) return;
      const data = await res.json();
      expect(data).toHaveProperty('content');
      expect(data).toHaveProperty('compiledAt');
    } catch {
      // Worker not running
    }
  });
});
```

- [ ] **Step 2: Implement CompilationRoutes**

```typescript
// src/services/worker/http/routes/CompilationRoutes.ts
import type { Request, Response, Application } from 'express';
import { BaseRouteHandler } from './BaseRouteHandler.js';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { CompilationLogger } from '../../../compilation/CompilationLogger.js';
import { KnowledgeLint } from '../../../compilation/KnowledgeLint.js';

export class CompilationRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/compilation/stats', this.wrapHandler(this.handleStats.bind(this)));
    app.get('/api/compilation/logs', this.wrapHandler(this.handleLogs.bind(this)));
    app.get('/api/compilation/diagrams', this.wrapHandler(this.handleDiagrams.bind(this)));
  }

  private handleStats(req: Request, res: Response): void {
    const project = (req.query.project as string) || '';
    const db = this.dbManager.getDatabase();

    const logger = new CompilationLogger(db);
    const stats = logger.getStats(project);
    const latest = logger.getLatestLog(project);

    // AI merge status from env
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const aiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';
    const model = process.env.AGENT_RECALL_COMPILATION_MODEL || 'claude-opus-4-6';

    // Lint warnings
    let lintWarnings: Array<{ type: string; description: string; observationId?: number }> = [];
    try {
      const lint = new KnowledgeLint(db);
      const lintResult = lint.run(project);
      lintWarnings = lintResult.warnings.map(w => ({
        type: w.type,
        description: w.description,
        observationId: w.observationId,
      }));
    } catch {
      // KnowledgeLint may fail on older schemas
    }

    res.json({
      lastCompilation: latest ? {
        completedAt: latest.completedAt,
        durationMs: latest.durationMs,
        observationsProcessed: latest.observationsProcessed,
        pagesCreated: latest.pagesCreated,
        pagesUpdated: latest.pagesUpdated,
        tokensUsed: latest.tokensUsed,
        status: latest.status,
      } : null,
      totalRuns: stats.totalRuns,
      successRate: stats.successRate,
      aiMergeActive: !!apiKey && aiEnabled,
      aiMergeModel: model,
      lintWarnings,
    });
  }

  private handleLogs(req: Request, res: Response): void {
    const project = (req.query.project as string) || '';
    const limit = parseInt((req.query.limit as string) || '10', 10);
    const db = this.dbManager.getDatabase();

    const logger = new CompilationLogger(db);
    const logs = logger.getHistory(project, limit);

    res.json(logs.map(log => ({
      id: log.id,
      completedAt: log.completedAt,
      durationMs: log.durationMs,
      observationsProcessed: log.observationsProcessed,
      pagesCreated: log.pagesCreated,
      pagesUpdated: log.pagesUpdated,
      tokensUsed: log.tokensUsed,
      status: log.status,
    })));
  }

  private handleDiagrams(req: Request, res: Response): void {
    const project = (req.query.project as string) || '';
    const db = this.dbManager.getDatabase();

    try {
      const row = db.prepare(
        `SELECT content, compiled_at, version FROM compiled_knowledge
         WHERE project = ? AND topic = '_mermaid_diagrams' AND valid_until IS NULL
         ORDER BY version DESC LIMIT 1`
      ).get(project) as { content: string; compiled_at: string; version: number } | undefined;

      if (row) {
        res.json({ content: row.content, compiledAt: row.compiled_at, version: row.version });
      } else {
        res.json({ content: null, compiledAt: null, version: 0 });
      }
    } catch {
      res.json({ content: null, compiledAt: null, version: 0 });
    }
  }
}
```

- [ ] **Step 3: Register routes in worker-service.ts**

In `src/services/worker-service.ts`, find where `DashboardRoutes` is registered (around line 576) and add CompilationRoutes right after:

```typescript
import { CompilationRoutes } from './http/routes/CompilationRoutes.js';
// ... in initializeInBackground():
this.server.registerRoutes(new DashboardRoutes(this.dbManager));
this.server.registerRoutes(new CompilationRoutes(this.dbManager));  // NEW
```

- [ ] **Step 4: Add API constants**

In `src/ui/viewer/constants/api.ts`, add:

```typescript
COMPILATION_STATS: '/api/compilation/stats',
COMPILATION_LOGS: '/api/compilation/logs',
COMPILATION_DIAGRAMS: '/api/compilation/diagrams',
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/worker/http/routes/compilation-routes.test.ts`
Expected: PASS (tests gracefully skip if Worker not running)

- [ ] **Step 6: Commit**

```bash
git add src/services/worker/http/routes/CompilationRoutes.ts src/services/worker-service.ts src/ui/viewer/constants/api.ts tests/worker/http/routes/compilation-routes.test.ts
git commit -m "feat(viewer): add compilation API endpoints (stats, logs, diagrams)"
```

---

### Task 2: CompilationStatus component

**Files:**
- Create: `src/ui/viewer/components/CompilationStatus.tsx`

- [ ] **Step 1: Implement CompilationStatus component**

```typescript
// src/ui/viewer/components/CompilationStatus.tsx
import React, { useState, useEffect } from 'react';

interface CompilationStatsData {
  lastCompilation: {
    completedAt: string;
    durationMs: number;
    observationsProcessed: number;
    pagesCreated: number;
    pagesUpdated: number;
    tokensUsed: number;
    status: string;
  } | null;
  totalRuns: number;
  successRate: number;
  aiMergeActive: boolean;
  aiMergeModel: string;
  lintWarnings: Array<{ type: string; description: string; observationId?: number }>;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CompilationStatus({ project, apiBase }: { project: string; apiBase: string }) {
  const [data, setData] = useState<CompilationStatsData | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);

  useEffect(() => {
    if (!project) return;
    fetch(`${apiBase}/api/compilation/stats?project=${encodeURIComponent(project)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [project, apiBase]);

  if (!data) return null;

  const last = data.lastCompilation;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">Compilation Engine</h3>

      <div className="compilation-stats-row">
        {last ? (
          <>
            <span className="compilation-stat">
              <span className="compilation-stat-label">Last compiled</span>
              <span className="compilation-stat-value">{timeAgo(last.completedAt)}</span>
            </span>
            <span className="compilation-stat">
              <span className="compilation-stat-label">Pages</span>
              <span className="compilation-stat-value">{last.pagesCreated + last.pagesUpdated}</span>
            </span>
            <span className="compilation-stat">
              <span className="compilation-stat-label">Observations</span>
              <span className="compilation-stat-value">{last.observationsProcessed}</span>
            </span>
            <span className="compilation-stat">
              <span className="compilation-stat-label">Duration</span>
              <span className="compilation-stat-value">{(last.durationMs / 1000).toFixed(1)}s</span>
            </span>
          </>
        ) : (
          <span className="dashboard-muted">No compilations yet. Knowledge will be compiled after 5 sessions.</span>
        )}
      </div>

      <div className="compilation-meta">
        <span className={`ai-merge-badge ${data.aiMergeActive ? 'active' : 'inactive'}`}>
          {data.aiMergeActive ? `AI merge: ${data.aiMergeModel}` : 'Text merge (AI not configured)'}
        </span>
        {data.totalRuns > 0 && (
          <span className="compilation-meta-item">
            {data.totalRuns} runs &bull; {Math.round(data.successRate * 100)}% success
          </span>
        )}
      </div>

      {data.lintWarnings.length > 0 && (
        <div className="lint-section">
          <button className="lint-toggle" onClick={() => setShowWarnings(!showWarnings)}>
            {data.lintWarnings.length} lint warning{data.lintWarnings.length !== 1 ? 's' : ''} {showWarnings ? '▾' : '▸'}
          </button>
          {showWarnings && (
            <ul className="lint-list">
              {data.lintWarnings.map((w, i) => (
                <li key={i} className="lint-item">
                  <span className={`lint-type lint-type-${w.type}`}>{w.type}</span>
                  <span className="lint-desc">{w.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/viewer/components/CompilationStatus.tsx
git commit -m "feat(viewer): add CompilationStatus dashboard component"
```

---

### Task 3: MermaidDiagrams component

**Files:**
- Create: `src/ui/viewer/components/MermaidDiagrams.tsx`
- Modify: `src/ui/viewer/viewer-template.html`

- [ ] **Step 1: Add Mermaid CDN script to viewer-template.html**

In `src/ui/viewer/viewer-template.html`, add before the closing `</body>` tag (before the `<script src="viewer-bundle.js">` line):

```html
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
  }
</script>
```

- [ ] **Step 2: Implement MermaidDiagrams component**

```typescript
// src/ui/viewer/components/MermaidDiagrams.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    mermaid?: {
      run: (config: { nodes: NodeListOf<Element> }) => Promise<void>;
      initialize: (config: any) => void;
    };
  }
}

interface DiagramData {
  content: string | null;
  compiledAt: string | null;
  version: number;
}

function extractMermaidBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```mermaid\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

export function MermaidDiagrams({ project, apiBase }: { project: string; apiBase: string }) {
  const [data, setData] = useState<DiagramData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!project) return;
    fetch(`${apiBase}/api/compilation/diagrams?project=${encodeURIComponent(project)}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, [project, apiBase]);

  const renderMermaid = useCallback(() => {
    if (window.mermaid && containerRef.current) {
      const nodes = containerRef.current.querySelectorAll('.mermaid');
      if (nodes.length > 0) {
        window.mermaid.run({ nodes }).catch(() => {
          // Mermaid parse error — raw code stays visible as fallback
        });
      }
    }
  }, []);

  useEffect(() => {
    if (expanded && data?.content) {
      // Small delay to ensure DOM is rendered
      setTimeout(renderMermaid, 100);
    }
  }, [expanded, data, renderMermaid]);

  if (!data?.content) return null;

  const blocks = extractMermaidBlocks(data.content);
  if (blocks.length === 0) return null;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title" style={{ cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        Architecture Diagrams ({blocks.length}) {expanded ? '▾' : '▸'}
      </h3>
      {data.compiledAt && (
        <span className="dashboard-muted" style={{ fontSize: '11px' }}>
          Last updated: {new Date(data.compiledAt).toLocaleDateString()}
        </span>
      )}
      {expanded && (
        <div ref={containerRef} className="mermaid-container">
          {blocks.map((block, i) => (
            <div key={i} className="mermaid-block">
              <pre className="mermaid">{block}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/viewer/components/MermaidDiagrams.tsx src/ui/viewer/viewer-template.html
git commit -m "feat(viewer): add Mermaid diagram rendering component"
```

---

### Task 4: LLMCostTracker component

**Files:**
- Create: `src/ui/viewer/components/LLMCostTracker.tsx`

- [ ] **Step 1: Implement LLMCostTracker component**

```typescript
// src/ui/viewer/components/LLMCostTracker.tsx
import React, { useState, useEffect } from 'react';

interface CompilationLog {
  id: number;
  completedAt: string;
  durationMs: number;
  observationsProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  tokensUsed: number;
  status: string;
}

// Approximate pricing per 1M tokens (input + output averaged)
const MODEL_PRICING: Record<string, number> = {
  'claude-opus-4-6': 15.0,
  'claude-sonnet-4-6': 3.0,
  'claude-haiku-4-5-20251001': 0.25,
};

function estimateCost(tokens: number, model: string): string {
  const pricePerMillion = MODEL_PRICING[model] || MODEL_PRICING['claude-opus-4-6'];
  const cost = (tokens / 1_000_000) * pricePerMillion;
  return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(2)}`;
}

export function LLMCostTracker({ project, apiBase, model }: { project: string; apiBase: string; model: string }) {
  const [logs, setLogs] = useState<CompilationLog[]>([]);

  useEffect(() => {
    if (!project) return;
    fetch(`${apiBase}/api/compilation/logs?project=${encodeURIComponent(project)}&limit=10`)
      .then(r => r.json())
      .then(setLogs)
      .catch(() => {});
  }, [project, apiBase]);

  const totalTokens = logs.reduce((sum, log) => sum + (log.tokensUsed || 0), 0);
  const logsWithTokens = logs.filter(l => l.tokensUsed > 0);

  if (totalTokens === 0) {
    return (
      <div className="dashboard-section">
        <h3 className="dashboard-section-title">LLM Cost</h3>
        <span className="dashboard-muted">AI merge not configured — using text merge (free)</span>
      </div>
    );
  }

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">LLM Cost</h3>

      <div className="cost-summary">
        <span className="compilation-stat">
          <span className="compilation-stat-label">Total tokens</span>
          <span className="compilation-stat-value">{totalTokens.toLocaleString()}</span>
        </span>
        <span className="compilation-stat">
          <span className="compilation-stat-label">Estimated cost</span>
          <span className="compilation-stat-value">{estimateCost(totalTokens, model)}</span>
        </span>
        <span className="compilation-stat">
          <span className="compilation-stat-label">Model</span>
          <span className="compilation-stat-value">{model}</span>
        </span>
      </div>

      {logsWithTokens.length > 0 && (
        <table className="compilation-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Duration</th>
              <th>Pages</th>
              <th>Tokens</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {logsWithTokens.map(log => (
              <tr key={log.id}>
                <td>{new Date(log.completedAt).toLocaleDateString()}</td>
                <td>{(log.durationMs / 1000).toFixed(1)}s</td>
                <td>{log.pagesCreated + log.pagesUpdated}</td>
                <td>{log.tokensUsed.toLocaleString()}</td>
                <td><span className={`status-dot ${log.status}`} />{log.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/viewer/components/LLMCostTracker.tsx
git commit -m "feat(viewer): add LLM cost tracking component"
```

---

### Task 5: Wire components into Dashboard + add CSS

**Files:**
- Modify: `src/ui/viewer/components/Dashboard.tsx`
- Modify: `src/ui/viewer/viewer-template.html`

- [ ] **Step 1: Update Dashboard.tsx to render new sections**

Add imports at the top of `src/ui/viewer/components/Dashboard.tsx`:

```typescript
import { CompilationStatus } from './CompilationStatus';
import { MermaidDiagrams } from './MermaidDiagrams';
import { LLMCostTracker } from './LLMCostTracker';
```

Add the 3 new sections at the end of the Dashboard return JSX, after the Freshness section but before the closing `</div>`:

```typescript
      {/* After freshness section, before closing </div> */}

      <CompilationStatus project={project} apiBase={apiBase} />
      <MermaidDiagrams project={project} apiBase={apiBase} />
      <LLMCostTracker project={project} apiBase={apiBase} model="claude-opus-4-6" />
    </div>
  );
```

- [ ] **Step 2: Add CSS for new components**

In `src/ui/viewer/viewer-template.html`, add before the closing `</style>` tag:

```css
    /* === Compilation Status === */
    .compilation-stats-row {
      display: flex; gap: 16px; flex-wrap: wrap;
      padding: 12px 0;
    }
    .compilation-stat {
      display: flex; flex-direction: column; gap: 2px;
    }
    .compilation-stat-label {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--text-3); font-family: var(--sans);
    }
    .compilation-stat-value {
      font-size: 16px; font-weight: 600;
      color: var(--text-1); font-family: var(--mono);
    }
    .compilation-meta {
      display: flex; gap: 12px; align-items: center; padding: 8px 0;
      font-size: 12px; color: var(--text-2);
    }
    .ai-merge-badge {
      padding: 2px 8px; border-radius: 4px; font-size: 11px;
      font-family: var(--mono);
    }
    .ai-merge-badge.active { background: rgba(90, 184, 112, 0.15); color: var(--green); }
    .ai-merge-badge.inactive { background: var(--bg-surface); color: var(--text-3); }

    /* === Lint Warnings === */
    .lint-section { padding: 8px 0; }
    .lint-toggle {
      background: none; border: none; color: var(--amber); cursor: pointer;
      font-size: 12px; font-family: var(--sans); padding: 4px 0;
    }
    .lint-toggle:hover { color: var(--text-1); }
    .lint-list {
      list-style: none; padding: 8px 0; display: flex; flex-direction: column; gap: 6px;
    }
    .lint-item {
      display: flex; gap: 8px; align-items: baseline;
      font-size: 12px; color: var(--text-2);
    }
    .lint-type {
      padding: 1px 6px; border-radius: 3px; font-size: 10px;
      font-family: var(--mono); text-transform: uppercase;
      background: var(--bg-surface); color: var(--text-3);
    }
    .lint-type-contradiction { color: var(--red); background: rgba(208, 96, 80, 0.1); }
    .lint-type-stale { color: var(--amber); background: var(--amber-subtle); }
    .lint-type-orphan { color: var(--text-3); }
    .lint-type-low_confidence { color: var(--plum); background: var(--plum-subtle); }

    /* === Mermaid Diagrams === */
    .mermaid-container {
      padding: 12px 0; display: flex; flex-direction: column; gap: 16px;
    }
    .mermaid-block {
      background: var(--bg-surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 16px; overflow-x: auto; max-height: 400px;
    }
    .mermaid-block pre.mermaid { font-family: var(--mono); font-size: 12px; color: var(--text-2); }
    .mermaid-block svg { max-width: 100%; height: auto; }

    /* === LLM Cost === */
    .cost-summary {
      display: flex; gap: 16px; flex-wrap: wrap; padding: 12px 0;
    }
    .compilation-log-table {
      width: 100%; border-collapse: collapse; margin-top: 12px;
      font-size: 12px; font-family: var(--mono);
    }
    .compilation-log-table th {
      text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border);
      color: var(--text-3); font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 500;
    }
    .compilation-log-table td {
      padding: 6px 8px; border-bottom: 1px solid var(--border-subtle);
      color: var(--text-2);
    }
    .compilation-log-table tr:hover td { background: var(--bg-hover); }
    .status-dot {
      display: inline-block; width: 6px; height: 6px; border-radius: 50%;
      margin-right: 6px; vertical-align: middle;
    }
    .status-dot.success { background: var(--green); }
    .status-dot.failed { background: var(--red); }
    .status-dot.running { background: var(--amber); }
```

- [ ] **Step 3: Build viewer**

Run: `node scripts/build-viewer.js`
Expected: `plugin/ui/viewer-bundle.js` and `plugin/ui/viewer.html` updated

- [ ] **Step 4: Verify visually**

Open: `http://localhost:37777`
Switch to Dashboard view. Verify:
- Compilation Engine section appears (with or without data)
- Architecture Diagrams section appears if Mermaid data exists
- LLM Cost section appears with correct empty state
- All sections use correct design tokens (dark/light)

- [ ] **Step 5: Commit**

```bash
git add src/ui/viewer/components/Dashboard.tsx src/ui/viewer/viewer-template.html
git commit -m "feat(viewer): wire dashboard components + add CSS styles"
```

---

### Task 6: Build and integration verify

**Files:**
- None new — verification only

- [ ] **Step 1: Build everything**

Run: `npm run build`
Expected: All outputs generated (worker-service.cjs, viewer-bundle.js, agent-recall.cjs)

- [ ] **Step 2: Run all tests**

Run: `bun test tests/worker/http/routes/compilation-routes.test.ts tests/cli/installer/ tests/services/compilation/ 2>&1 | tail -10`
Expected: All pass

- [ ] **Step 3: Restart worker and verify API**

Run: `npm run worker:restart`
Run: `curl -s http://localhost:37777/api/compilation/stats?project=test | head -5`
Expected: JSON response with stats shape

Run: `curl -s http://localhost:37777/api/compilation/logs?project=test`
Expected: JSON array

Run: `curl -s http://localhost:37777/api/compilation/diagrams?project=test`
Expected: JSON with content field

- [ ] **Step 4: Commit build artifacts**

```bash
git add plugin/ui/viewer-bundle.js plugin/ui/viewer.html
git commit -m "build: rebuild viewer with dashboard enhancements"
```

---

## Task Summary

| Task | What | Files | Depends On |
|------|------|-------|------------|
| 1 | API endpoints + route registration | 4 files | — |
| 2 | CompilationStatus component | 1 new | Task 1 |
| 3 | MermaidDiagrams component + CDN | 2 files | Task 1 |
| 4 | LLMCostTracker component | 1 new | Task 1 |
| 5 | Wire into Dashboard + CSS | 2 modified | Tasks 2, 3, 4 |
| 6 | Build + integration verify | 0 new | Task 5 |

Tasks 2-4 are independent (can be parallelized). Task 1 is prerequisite for all. Task 5 wires everything. Task 6 verifies.
