import React from 'react';
import { useSessions } from '../hooks/useSessions';

interface SessionViewProps {
  projectFilter: string;
}

function formatSessionTime(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDateGroup(epoch: number): string {
  const d = new Date(epoch);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (itemDate.getTime() === today.getTime()) return 'Today';
  if (itemDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function SessionView({ projectFilter }: SessionViewProps) {
  const { sessions, isLoading } = useSessions(projectFilter);

  if (isLoading) {
    return (
      <div className="timeline-container" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-3)' }}>
        <span className="spinner" style={{ marginRight: '8px' }}></span> Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="timeline-container" style={{ textAlign: 'center', padding: '60px 32px', color: 'var(--text-3)' }}>
        No sessions found
      </div>
    );
  }

  // Group by date
  const groups: { label: string; items: typeof sessions }[] = [];
  let currentLabel = '';
  for (const session of sessions) {
    const label = getDateGroup(session.created_at_epoch);
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, items: [] });
    }
    groups[groups.length - 1].items.push(session);
  }

  return (
    <div className="timeline-container">
      <div className="timeline">
        {groups.map(group => (
          <React.Fragment key={group.label}>
            <div className="timeline-group-label">{group.label}</div>
            {group.items.map(session => (
              <div key={session.id} className="session-card">
                <div className="session-card-header">
                  <span className="session-project">{session.project}</span>
                  <span className="session-time">
                    {formatSessionTime(session.created_at_epoch)}
                    {session.ended_at && ` \u2013 ${formatSessionTime(new Date(session.ended_at).getTime())}`}
                  </span>
                </div>
                {session.summary && (
                  <div className="session-summary-text">{session.summary}</div>
                )}
                <div className="session-metrics">
                  <span className="session-metric"><strong>{session.prompt_count || 0}</strong> prompts</span>
                  <span className="session-metric"><strong>{session.observation_count || 0}</strong> observations</span>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
