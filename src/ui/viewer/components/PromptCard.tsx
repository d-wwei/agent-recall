import React from 'react';
import { UserPrompt } from '../types';
import { formatDate } from '../utils/formatters';

interface PromptCardProps {
  prompt: UserPrompt;
}

export function PromptCard({ prompt }: PromptCardProps) {
  const date = formatDate(prompt.created_at_epoch);

  return (
    <div className="card">
      <div className="card-meta">
        <span className="badge pmt">prompt</span>
        <span className="dot-sep">&bull;</span>
        <span className="card-project">{prompt.project}</span>
        <span className="dot-sep">&bull;</span>
        <span className="time">{date}</span>
      </div>
      <div className="title">Prompt #{prompt.prompt_number || prompt.id}</div>
      <div className="prompt-text">{prompt.prompt_text}</div>
    </div>
  );
}
