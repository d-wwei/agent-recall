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

const MODEL_PRICING: Record<string, number> = {
  'claude-opus': 15,
  'claude-opus-4-6': 15,
  'claude-sonnet': 3,
  'claude-haiku': 0.25,
};

function getPricePerMillion(model: string): number {
  const key = Object.keys(MODEL_PRICING).find(k => model.toLowerCase().includes(k));
  return key ? MODEL_PRICING[key] : 3; // default to sonnet pricing
}

function estimateCost(tokens: number, pricePerMillion: number): string {
  return ((tokens / 1_000_000) * pricePerMillion).toFixed(4);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function LLMCostTracker({
  project,
  apiBase,
  model,
}: {
  project: string;
  apiBase: string;
  model: string;
}) {
  const [logs, setLogs] = useState<CompilationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${apiBase}/api/compilation/logs?project=${encodeURIComponent(project)}&limit=10`)
      .then(r => r.json())
      .then(d => {
        setLogs(Array.isArray(d) ? d : (d.logs ?? []));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [project, apiBase]);

  if (loading) return null;

  const pricePerMillion = getPricePerMillion(model);
  const logsWithTokens = logs.filter(l => l.tokensUsed > 0);
  const totalTokens = logsWithTokens.reduce((acc, l) => acc + l.tokensUsed, 0);
  const aiMergeConfigured = logsWithTokens.length > 0;

  return (
    <div className="dashboard-section">
      <h3 className="dashboard-section-title">LLM Cost Tracker</h3>

      {!aiMergeConfigured ? (
        <div className="dashboard-muted">
          AI merge not configured — using text merge (free)
        </div>
      ) : (
        <>
          <div className="cost-summary">
            <div className="compilation-stat">
              <span className="compilation-stat-label">Total Tokens</span>
              <span className="compilation-stat-value">{formatTokens(totalTokens)}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Est. Cost</span>
              <span className="compilation-stat-value">${estimateCost(totalTokens, pricePerMillion)}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Model</span>
              <span className="compilation-stat-value" style={{ fontSize: '11px' }}>{model}</span>
            </div>
            <div className="compilation-stat">
              <span className="compilation-stat-label">Rate</span>
              <span className="compilation-stat-value">${pricePerMillion}/1M</span>
            </div>
          </div>

          {logsWithTokens.length > 0 && (
            <table className="compilation-log-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Pages</th>
                </tr>
              </thead>
              <tbody>
                {logsWithTokens.map(log => (
                  <tr key={log.id}>
                    <td>{formatDate(log.completedAt)}</td>
                    <td>
                      <span className={`status-dot ${log.status}`} title={log.status} />
                      {log.status}
                    </td>
                    <td>{formatTokens(log.tokensUsed)}</td>
                    <td>${estimateCost(log.tokensUsed, pricePerMillion)}</td>
                    <td>{log.pagesCreated + log.pagesUpdated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
