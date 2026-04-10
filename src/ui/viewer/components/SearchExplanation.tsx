import React from 'react';

interface ExplainedResult {
  matchScore: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
  matchedKeywords: string[];
}

export function SearchExplanation({ explanation }: { explanation: ExplainedResult }) {
  const scorePercent = Math.round(explanation.matchScore * 100);
  const typeColors: Record<string, string> = {
    semantic: '#8b5cf6',
    keyword: '#3b82f6',
    hybrid: '#10b981',
  };

  return (
    <div className="search-explanation">
      <span className="match-score" style={{ color: scorePercent > 70 ? '#22c55e' : '#eab308' }}>
        {scorePercent}%
      </span>
      <span className="match-type" style={{ backgroundColor: typeColors[explanation.matchType] || '#6b7280' }}>
        {explanation.matchType}
      </span>
      {explanation.matchedKeywords.length > 0 && (
        <span className="matched-keywords">
          {explanation.matchedKeywords.map(kw => (
            <span key={kw} className="keyword-highlight">{kw}</span>
          ))}
        </span>
      )}
    </div>
  );
}
