import React, { useState, useEffect } from 'react';

interface LastCompilation {
  completedAt: string;
  durationMs: number;
  observationsProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  tokensUsed: number;
  status: string;
}

interface CompilationStatsData {
  lastCompilation: LastCompilation | null;
  totalRuns: number;
  successRate: number;
  aiMergeActive: boolean;
  aiMergeModel: string;
  lintWarnings: Array<{ type: string; description: string; observationId?: number }>;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const LINT_COLORS: Record<string, string> = {
  contradiction: 'lint-type-contradiction',
  stale: 'lint-type-stale',
  orphan: 'lint-type-orphan',
  low_confidence: 'lint-type-low_confidence',
};

export function CompilationStatus({ project, apiBase }: { project: string; apiBase: string }) {
  const [data, setData] = useState<CompilationStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lintOpen, setLintOpen] = useState(false);

  useEffect(() => {
    if (!project) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${apiBase}/api/compilation/stats?project=${encodeURIComponent(project)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [project, apiBase]);

  if (loading) return null;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">Compilation Engine</h3>

      {!data || !data.lastCompilation ? (
        <div className="dashboard-muted">No compilations yet.</div>
      ) : (
        <>
          <div className="compilation-stats-row">
            <div className="compilation-stat">
              <span className="compilation-stat-label">Last Run</span>
              <span className="compilation-stat-value">{timeAgo(data.lastCompilation.completedAt)}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Pages</span>
              <span className="compilation-stat-value">
                {data.lastCompilation.pagesCreated + data.lastCompilation.pagesUpdated}
              </span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Observations</span>
              <span className="compilation-stat-value">{data.lastCompilation.observationsProcessed}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Duration</span>
              <span className="compilation-stat-value">{formatDuration(data.lastCompilation.durationMs)}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Success Rate</span>
              <span className="compilation-stat-value">{Math.round(data.successRate * 100)}%</span>
            </div>
          </div>

          <div className="compilation-meta">
            <span
              className={`ai-merge-badge ${data.aiMergeActive ? 'active' : 'inactive'}`}
              title={data.aiMergeActive ? `Model: ${data.aiMergeModel}` : 'AI merge not configured'}
            >
              AI Merge {data.aiMergeActive ? 'active' : 'not configured'}
            </span>

            {data.lintWarnings.length > 0 && (
              <button
                className="lint-toggle"
                onClick={() => setLintOpen(v => !v)}
              >
                {lintOpen ? 'Hide' : 'Show'} {data.lintWarnings.length} lint warning{data.lintWarnings.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {lintOpen && data.lintWarnings.length > 0 && (
            <ul className="lint-list">
              {data.lintWarnings.map((w, i) => (
                <li key={i} className="lint-item">
                  <span className={`lint-type ${LINT_COLORS[w.type] ?? ''}`}>{w.type}</span>
                  <span className="lint-description">{w.description}</span>
                  {w.observationId !== undefined && (
                    <span className="lint-obs-id"> #{w.observationId}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
