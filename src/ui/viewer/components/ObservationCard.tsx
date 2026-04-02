import React, { useState } from 'react';
import { Observation } from '../types';
import { formatDate } from '../utils/formatters';

interface ObservationCardProps {
  observation: Observation;
}

function stripProjectRoot(filePath: string): string {
  const markers = ['/Scripts/', '/src/', '/plugin/', '/docs/'];
  for (const marker of markers) {
    const index = filePath.indexOf(marker);
    if (index !== -1) return filePath.substring(index + 1);
  }
  const projectIndex = filePath.indexOf('agent-recall/');
  if (projectIndex !== -1) return filePath.substring(projectIndex + 'agent-recall/'.length);
  const parts = filePath.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : filePath;
}

export function ObservationCard({ observation }: ObservationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const date = formatDate(observation.created_at_epoch);

  const facts = observation.facts ? JSON.parse(observation.facts) : [];
  const concepts = observation.concepts ? JSON.parse(observation.concepts) : [];
  const filesRead = observation.files_read ? JSON.parse(observation.files_read).map(stripProjectRoot) : [];
  const filesModified = observation.files_modified ? JSON.parse(observation.files_modified).map(stripProjectRoot) : [];
  const hasExpandContent = observation.narrative || facts.length > 0;

  return (
    <div className="card" onClick={() => hasExpandContent && setExpanded(!expanded)}>
      <div className="card-meta">
        <span className="badge obs">{observation.type || 'observation'}</span>
        <span className="dot-sep">&bull;</span>
        <span className="card-project">{observation.project}</span>
        <span className="dot-sep">&bull;</span>
        <span className="time">{date}</span>
      </div>
      <div className="title">{observation.title || 'Untitled'}</div>
      {!expanded && observation.subtitle && (
        <div className="sub">{observation.subtitle}</div>
      )}
      {expanded && (
        <div className="card-expand">
          {observation.narrative && (
            <p className="narrative">{observation.narrative}</p>
          )}
          {facts.length > 0 && (
            <ul className="facts">
              {facts.map((fact: string, i: number) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
          )}
          {concepts.length > 0 && (
            <div className="tags">
              {concepts.map((c: string, i: number) => (
                <span key={i} className="tag">{c}</span>
              ))}
            </div>
          )}
          {(filesRead.length > 0 || filesModified.length > 0) && (
            <div className="files">
              {filesModified.map((f: string, i: number) => (
                <span key={`m-${i}`} className="file"><span className="fdot m"></span>{f}</span>
              ))}
              {filesRead.map((f: string, i: number) => (
                <span key={`r-${i}`} className="file"><span className="fdot r"></span>{f}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
