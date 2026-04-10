import React, { useState, useEffect } from 'react';

interface DashboardData {
  totalObservations: number;
  thisWeekNew: number;
  byType: Record<string, number>;
  topConcepts: { concept: string; count: number }[];
  freshness: { hot: number; warm: number; cold: number; archive: number };
  compiledPages: number;
  lintWarnings: number;
  totalEntities: number;
  totalFacts: number;
  diaryEntries: number;
}

export function Dashboard({ project, apiBase }: { project: string; apiBase: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`${apiBase}/api/dashboard?project=${encodeURIComponent(project)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [project, apiBase]);

  if (!project) {
    return (
      <div className="dashboard">
        <div className="dashboard-empty">Select a project to view dashboard metrics.</div>
      </div>
    );
  }

  if (loading) return <div className="dashboard"><div className="dashboard-loading"><span className="spinner" /> Loading dashboard...</div></div>;
  if (!data) return <div className="dashboard"><div className="dashboard-error">Failed to load dashboard data.</div></div>;

  const safeTotal = data.totalObservations || 1; // avoid division by zero

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">Memory Health</h2>

      <div className="dashboard-grid">
        <div className="stat-card">
          <div className="stat-value">{data.totalObservations.toLocaleString()}</div>
          <div className="stat-label">Total Observations</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.thisWeekNew.toLocaleString()}</div>
          <div className="stat-label">This Week</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.compiledPages.toLocaleString()}</div>
          <div className="stat-label">Compiled Pages</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.lintWarnings.toLocaleString()}</div>
          <div className="stat-label">Lint Warnings</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.totalEntities.toLocaleString()}</div>
          <div className="stat-label">Entities</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{data.diaryEntries.toLocaleString()}</div>
          <div className="stat-label">Diary Entries</div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Type Distribution</h3>
        <div className="type-bars">
          {Object.entries(data.byType).map(([type, count]) => (
            <div key={type} className="type-bar">
              <span className="type-name">{type}</span>
              <div className="type-fill" style={{ width: `${(count / safeTotal) * 100}%` }} />
              <span className="type-count">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Top Concepts</h3>
        <div className="concept-list">
          {data.topConcepts.slice(0, 10).map(c => (
            <span key={c.concept} className="concept-tag">{c.concept} ({c.count})</span>
          ))}
          {data.topConcepts.length === 0 && (
            <span className="dashboard-muted">No concepts extracted yet.</span>
          )}
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Freshness</h3>
        <div className="freshness-bar">
          {data.freshness.hot > 0 && (
            <div className="fresh-hot" style={{ width: `${(data.freshness.hot / safeTotal) * 100}%` }} title={`Hot: ${data.freshness.hot}`} />
          )}
          {data.freshness.warm > 0 && (
            <div className="fresh-warm" style={{ width: `${(data.freshness.warm / safeTotal) * 100}%` }} title={`Warm: ${data.freshness.warm}`} />
          )}
          {data.freshness.cold > 0 && (
            <div className="fresh-cold" style={{ width: `${(data.freshness.cold / safeTotal) * 100}%` }} title={`Cold: ${data.freshness.cold}`} />
          )}
          {data.freshness.archive > 0 && (
            <div className="fresh-archive" style={{ width: `${(data.freshness.archive / safeTotal) * 100}%` }} title={`Archive: ${data.freshness.archive}`} />
          )}
        </div>
        <div className="freshness-legend">
          <span><span className="dot hot" /> Hot ({data.freshness.hot})</span>
          <span><span className="dot warm" /> Warm ({data.freshness.warm})</span>
          <span><span className="dot cold" /> Cold ({data.freshness.cold})</span>
          <span><span className="dot archive" /> Archive ({data.freshness.archive})</span>
        </div>
      </div>
    </div>
  );
}
