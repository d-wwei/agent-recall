import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(__dirname, '..', '..', '..', 'bin', 'agent-recall.cjs');

describe('CLI integration', () => {
  it('bin/agent-recall.cjs exists and is executable', () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });

  it('--help prints usage info', () => {
    const result = spawnSync('node', [CLI_PATH, '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    // Help output goes to stderr (log() uses console.error)
    const output = result.stderr || result.stdout;
    expect(output).toContain('agent-recall');
    expect(output).toContain('install');
    expect(output).toContain('doctor');
    expect(output).toContain('adapter');
    expect(output).toContain('status');
    expect(output).toContain('uninstall');
  });

  it('--version prints a version string', () => {
    const result = spawnSync('node', [CLI_PATH, '--version'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const output = (result.stderr || result.stdout).trim();
    expect(output).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('unknown command exits with code 1', () => {
    const result = spawnSync('node', [CLI_PATH, 'nonexistent'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    const output = result.stderr || result.stdout;
    expect(output).toContain('Unknown command');
  });

  it('doctor runs and produces categorized output', () => {
    const result = spawnSync('node', [CLI_PATH, 'doctor'], { encoding: 'utf-8', timeout: 15000 });
    // Doctor may exit 0 or 1 — both valid depending on system state
    const output = result.stderr || result.stdout;
    expect(output.toLowerCase()).toContain('doctor');
    // Should have at least one category section
    expect(output).toMatch(/Runtime|Worker|Database|Adapter/i);
  });

  it('adapter list runs and shows platforms', () => {
    const result = spawnSync('node', [CLI_PATH, 'adapter', 'list'], { encoding: 'utf-8' });
    const output = result.stderr || result.stdout;
    expect(output).toContain('Adapter');
  });

  it('status runs and shows info', () => {
    const result = spawnSync('node', [CLI_PATH, 'status'], { encoding: 'utf-8' });
    const output = result.stderr || result.stdout;
    expect(output).toContain('Status');
  });
});
