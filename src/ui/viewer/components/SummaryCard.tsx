import React, { useState } from 'react';
import { Summary } from '../types';
import { formatDate } from '../utils/formatters';

interface SummaryCardProps {
  summary: Summary;
}

export function SummaryCard({ summary }: SummaryCardProps) {
  const [expanded, setExpanded] = useState(true);
  const date = formatDate(summary.created_at_epoch);

  const sections = [
    { key: 'investigated', label: 'Investigated', content: summary.investigated },
    { key: 'learned', label: 'Learned', content: summary.learned },
    { key: 'completed', label: 'Completed', content: summary.completed },
    { key: 'next_steps', label: 'Next Steps', content: summary.next_steps },
  ].filter(s => s.content);

  return (
    <div className="card" onClick={() => setExpanded(!expanded)}>
      <div className="card-meta">
        <span className="badge sum">summary</span>
        <span className="dot-sep">&bull;</span>
        <span className="card-project">{summary.project}</span>
        <span className="dot-sep">&bull;</span>
        <span className="time">{date}</span>
      </div>
      <div className="title">Session #{summary.id}{summary.request ? ` — ${summary.request}` : ''}</div>
      {!expanded && summary.request && (
        <div className="sub">{summary.request}</div>
      )}
      {expanded && sections.length > 0 && (
        <div className="quad">
          {sections.map(section => (
            <div key={section.key} className="q">
              <div className="q-label">{section.label}</div>
              <div className="q-text">{section.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
