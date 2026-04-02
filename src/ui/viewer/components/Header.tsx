import React from 'react';
import { ThemeToggle } from './ThemeToggle';
import { ThemePreference } from '../hooks/useTheme';
import { useSpinningFavicon } from '../hooks/useSpinningFavicon';

interface HeaderProps {
  isConnected: boolean;
  projects: string[];
  currentFilter: string;
  onFilterChange: (filter: string) => void;
  isProcessing: boolean;
  queueDepth: number;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onSettingsToggle: () => void;
  onSearchToggle: () => void;
}

export function Header({
  isConnected,
  projects,
  currentFilter,
  onFilterChange,
  isProcessing,
  queueDepth,
  themePreference,
  onThemeChange,
  onSettingsToggle,
  onSearchToggle
}: HeaderProps) {
  useSpinningFavicon(isProcessing);

  return (
    <>
      <div className="header">
        <div className="logo">
          <div className={`logo-dot ${!isConnected ? 'offline' : ''}`} />
          <span className="logo-text">Agent <em>Recall</em></span>
        </div>
        <div className="hdr-r">
          {queueDepth > 0 && (
            <span className="queue-badge">queue: <strong>{queueDepth}</strong></span>
          )}
          <select
            className="project-select"
            value={currentFilter}
            onChange={e => onFilterChange((e.target as HTMLSelectElement).value)}
          >
            <option value="">all projects</option>
            {projects.map(project => (
              <option key={project} value={project}>{project}</option>
            ))}
          </select>
          <button className="icon-btn" onClick={onSearchToggle} title="Search (⌘K)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
          </button>
          <button className="icon-btn" onClick={onSettingsToggle} title="Settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
              <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
              <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
              <line x1="17" y1="16" x2="23" y2="16"/>
            </svg>
          </button>
          <ThemeToggle
            preference={themePreference}
            onThemeChange={onThemeChange}
          />
        </div>
      </div>
      <hr className="header-divider" />
    </>
  );
}
