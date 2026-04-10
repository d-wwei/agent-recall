import React from 'react';
import { Observation, Summary, UserPrompt } from '../types';

type ViewMode = 'timeline' | 'sessions' | 'dashboard';
type TypeFilter = 'all' | 'observations' | 'summaries' | 'prompts';

interface ToolbarProps {
  observations: Observation[];
  summaries: Summary[];
  prompts: UserPrompt[];
  typeFilter: TypeFilter;
  onTypeFilterChange: (filter: TypeFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function Toolbar({
  observations,
  summaries,
  prompts,
  typeFilter,
  onTypeFilterChange,
  viewMode,
  onViewModeChange
}: ToolbarProps) {
  const total = observations.length + summaries.length + prompts.length;

  const filters: { key: TypeFilter; label: string; count: number }[] = [
    { key: 'all', label: 'all', count: total },
    { key: 'observations', label: 'observations', count: observations.length },
    { key: 'summaries', label: 'summaries', count: summaries.length },
    { key: 'prompts', label: 'prompts', count: prompts.length },
  ];

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        {filters.map(f => (
          <button
            key={f.key}
            className={`pill ${typeFilter === f.key ? 'on' : ''}`}
            onClick={() => onTypeFilterChange(f.key)}
          >
            {f.label}<span className="count">{f.count.toLocaleString()}</span>
          </button>
        ))}
      </div>
      <div className="toolbar-right">
        <div className="view-toggle">
          <button
            className={viewMode === 'timeline' ? 'on' : ''}
            onClick={() => onViewModeChange('timeline')}
            title="Timeline"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </button>
          <button
            className={viewMode === 'sessions' ? 'on' : ''}
            onClick={() => onViewModeChange('sessions')}
            title="By session"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button
            className={viewMode === 'dashboard' ? 'on' : ''}
            onClick={() => onViewModeChange('dashboard')}
            title="Dashboard"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
