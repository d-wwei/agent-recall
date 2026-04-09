import { describe, it, expect } from 'bun:test';
import { renderRecallProtocol } from '../../src/services/context/sections/RecallProtocolRenderer.js';

describe('RecallProtocolRenderer', () => {
  it('renders protocol directives as markdown', () => {
    const lines = renderRecallProtocol(false);
    const output = lines.join('\n');

    expect(output).toContain('Memory Protocol');
    expect(output).toContain('search memory');
    expect(output).toContain('contradicting');
    expect(output).toContain('preferences');
  });

  it('renders with color support', () => {
    const lines = renderRecallProtocol(true);
    const output = lines.join('\n');

    // Heading wrapped in ANSI bold cyan
    expect(output).toContain('\x1b[1;36m');
    expect(output).toContain('\x1b[0m');

    // Directives still present
    expect(output).toContain('Memory Protocol');
    expect(output).toContain('search memory');
  });

  it('output is under 300 tokens (~1200 chars)', () => {
    const lines = renderRecallProtocol(false);
    const output = lines.join('\n');

    // 1 token ≈ 4 chars; 300 tokens ≈ 1200 chars
    expect(output.length).toBeLessThan(1200);
  });
});
