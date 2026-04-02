import React from 'react';
import { ThemePreference } from '../hooks/useTheme';

interface ThemeToggleProps {
  preference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

export function ThemeToggle({ preference, onThemeChange }: ThemeToggleProps) {
  const cycleTheme = () => {
    const cycle: ThemePreference[] = ['system', 'light', 'dark'];
    const currentIndex = cycle.indexOf(preference);
    const nextIndex = (currentIndex + 1) % cycle.length;
    onThemeChange(cycle[nextIndex]);
  };

  const getIcon = () => {
    switch (preference) {
      case 'light':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        );
      case 'dark':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        );
      case 'system':
      default:
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        );
    }
  };

  const getTitle = () => {
    switch (preference) {
      case 'light':
        return 'Theme: Light (click for Dark)';
      case 'dark':
        return 'Theme: Dark (click for System)';
      case 'system':
      default:
        return 'Theme: System (click for Light)';
    }
  };

  return (
    <button
      className="icon-btn"
      onClick={cycleTheme}
      title={getTitle()}
      aria-label={getTitle()}
    >
      {getIcon()}
    </button>
  );
}
