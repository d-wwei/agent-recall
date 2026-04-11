import React, { useState, useEffect, useRef } from 'react';

declare global {
  interface Window {
    mermaid?: {
      run: (config: { nodes: NodeListOf<Element> }) => Promise<void>;
    };
  }
}

interface DiagramData {
  content: string | null;
  compiledAt: string | null;
  version: number;
}

function extractMermaidBlocks(content: string): string[] {
  const regex = /```mermaid\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

export function MermaidDiagrams({ project, apiBase }: { project: string; apiBase: string }) {
  const [data, setData] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!project) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    renderedRef.current = false;
    fetch(`${apiBase}/api/compilation/diagrams?project=${encodeURIComponent(project)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [project, apiBase]);

  // Run mermaid after the diagram nodes are in the DOM
  useEffect(() => {
    if (!open || renderedRef.current || !containerRef.current) return;
    if (!window.mermaid) return;
    const nodes = containerRef.current.querySelectorAll('.mermaid-block');
    if (nodes.length === 0) return;
    renderedRef.current = true;
    window.mermaid.run({ nodes }).catch(() => {
      // silently ignore render errors — raw code is still visible
    });
  }, [open, data]);

  if (loading || !data || !data.content) return null;

  const blocks = extractMermaidBlocks(data.content);
  if (blocks.length === 0) return null;

  return (
    <div className="dashboard-section">
      <h3
        className="dashboard-section-title mermaid-toggle"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(v => !v)}
      >
        Architecture Diagrams ({blocks.length}) {open ? '▲' : '▼'}
      </h3>

      {open && (
        <div className="mermaid-container" ref={containerRef}>
          {blocks.map((block, i) => (
            window.mermaid ? (
              <pre
                key={i}
                className="mermaid-block mermaid"
              >
                {block}
              </pre>
            ) : (
              <pre key={i} className="mermaid-block mermaid-raw">
                <code>{block}</code>
              </pre>
            )
          ))}
        </div>
      )}
    </div>
  );
}
