import React, { useRef, useEffect, useState } from 'react';
import { useSearch } from '../hooks/useSearch';
import { formatDate } from '../utils/formatters';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { query, results, isSearching, search, clear } = useSearch();
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setFocusIndex(0);
    } else {
      clear();
    }
  }, [isOpen, clear]);

  useEffect(() => {
    setFocusIndex(0);
  }, [results]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const typeClass = (type: string) => {
    if (type === 'observation') return 'obs';
    if (type === 'summary') return 'sum';
    return 'pmt';
  };

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="cmd-palette-input"
          value={query}
          onChange={e => search((e.target as HTMLInputElement).value)}
          placeholder="Search memories..."
        />
        <div className="cmd-palette-results">
          {isSearching && (
            <div className="cmd-result" style={{ justifyContent: 'center', color: 'var(--text-3)' }}>
              <span className="spinner" style={{ marginRight: '8px' }}></span> Searching...
            </div>
          )}
          {!isSearching && query && results.length === 0 && (
            <div className="cmd-result" style={{ justifyContent: 'center', color: 'var(--text-4)' }}>
              No results found
            </div>
          )}
          {results.map((result, i) => (
            <div
              key={`${result.type}-${result.id}`}
              className={`cmd-result ${i === focusIndex ? 'focused' : ''}`}
              onMouseEnter={() => setFocusIndex(i)}
            >
              <div className={`cmd-result-icon ${typeClass(result.type)}`}>
                {result.type === 'observation' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                )}
                {result.type === 'summary' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>
                )}
                {result.type === 'prompt' && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                )}
              </div>
              <div className="cmd-result-text">
                <div className="cmd-result-title">{result.title}</div>
                <div className="cmd-result-sub">
                  {result.type} · {result.project} · {formatDate(result.created_at_epoch)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="cmd-palette-footer">
          <span><kbd>&uarr;</kbd> <kbd>&darr;</kbd> Navigate</span>
          <span><kbd>&crarr;</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
