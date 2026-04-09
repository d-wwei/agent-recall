/**
 * RecallMcpTools tests (8.1)
 *
 * Validates tool definitions, JSON schemas, uniqueness, required fields, and
 * URL construction for all five recall MCP tools.
 *
 * What is tested:
 *   - createRecallTools returns exactly 5 tools
 *   - All tool names are unique
 *   - Every tool has a non-empty description
 *   - Every tool has a callable handler function
 *   - inputSchema is a valid JSON-Schema object (type: object, properties present)
 *   - Required fields are declared correctly for each tool
 *   - Handler builds correct URLs (verified via fetch mock)
 *   - recall_search uses default limit 10 when not provided
 *   - recall_search forwards project filter when provided
 *   - recall_timeline uses default days 7 when not provided
 *   - recall_compile issues a POST with correct body
 *   - recall_dashboard builds correct query params
 *   - recall_kg_query falls back to empty string when entityName is omitted
 *
 * What is NOT tested:
 *   - Real HTTP calls to the Worker (external service dependency)
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createRecallTools, type McpToolDefinition } from '../../src/servers/RecallMcpTools.js';

// ---------------------------------------------------------------------------
// fetch mock — intercepts all calls made by the handlers
// ---------------------------------------------------------------------------

interface CapturedCall {
  url: string;
  init?: RequestInit;
}

let capturedCalls: CapturedCall[] = [];
const mockFetchResponse = (data: unknown = { ok: true }) =>
  Promise.resolve(new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

const originalFetch = globalThis.fetch;
beforeEach(() => {
  capturedCalls = [];
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    capturedCalls.push({ url: String(url), init });
    return mockFetchResponse({ result: 'mock' });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:37777';

function getTools(): McpToolDefinition[] {
  return createRecallTools(BASE_URL);
}

function findTool(tools: McpToolDefinition[], name: string): McpToolDefinition {
  const t = tools.find(t => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
}

// ---------------------------------------------------------------------------
// Suite: tool collection invariants
// ---------------------------------------------------------------------------

describe('RecallMcpTools — collection', () => {
  it('creates exactly 5 tools', () => {
    expect(getTools()).toHaveLength(5);
  });

  it('all tool names are unique', () => {
    const names = getTools().map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all tools have a non-empty description', () => {
    getTools().forEach(t => {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
    });
  });

  it('all tools have a callable handler', () => {
    getTools().forEach(t => {
      expect(typeof t.handler).toBe('function');
    });
  });

  it('all tools have an inputSchema with type "object"', () => {
    getTools().forEach(t => {
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe('object');
    });
  });

  it('all tools have an inputSchema.properties object', () => {
    getTools().forEach(t => {
      expect(typeof t.inputSchema.properties).toBe('object');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: recall_search
// ---------------------------------------------------------------------------

describe('recall_search', () => {
  it('requires "query" in inputSchema.required', () => {
    const t = findTool(getTools(), 'recall_search');
    expect(t.inputSchema.required).toContain('query');
  });

  it('query property has type string', () => {
    const t = findTool(getTools(), 'recall_search');
    expect(t.inputSchema.properties.query.type).toBe('string');
  });

  it('handler calls /api/search with q param', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'authentication' });
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]!.url).toContain('/api/search');
    expect(capturedCalls[0]!.url).toContain('q=authentication');
  });

  it('handler uses default limit 10 when not provided', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'foo' });
    expect(capturedCalls[0]!.url).toContain('limit=10');
  });

  it('handler respects explicit limit', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'foo', limit: 25 });
    expect(capturedCalls[0]!.url).toContain('limit=25');
  });

  it('handler includes project param when provided', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'foo', project: 'my-project' });
    expect(capturedCalls[0]!.url).toContain('project=my-project');
  });

  it('handler omits project param when not provided', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'foo' });
    expect(capturedCalls[0]!.url).not.toContain('project=');
  });

  it('handler targets the configured base URL', async () => {
    const t = findTool(getTools(), 'recall_search');
    await t.handler({ query: 'test' });
    expect(capturedCalls[0]!.url).toStartWith(BASE_URL);
  });
});

// ---------------------------------------------------------------------------
// Suite: recall_timeline
// ---------------------------------------------------------------------------

describe('recall_timeline', () => {
  it('requires "project" in inputSchema.required', () => {
    const t = findTool(getTools(), 'recall_timeline');
    expect(t.inputSchema.required).toContain('project');
  });

  it('project property has type string', () => {
    const t = findTool(getTools(), 'recall_timeline');
    expect(t.inputSchema.properties.project.type).toBe('string');
  });

  it('handler calls /api/timeline with project param', async () => {
    const t = findTool(getTools(), 'recall_timeline');
    await t.handler({ project: 'agent-recall' });
    expect(capturedCalls[0]!.url).toContain('/api/timeline');
    expect(capturedCalls[0]!.url).toContain('project=agent-recall');
  });

  it('handler uses default days 7 when not provided', async () => {
    const t = findTool(getTools(), 'recall_timeline');
    await t.handler({ project: 'x' });
    expect(capturedCalls[0]!.url).toContain('days=7');
  });

  it('handler respects explicit days', async () => {
    const t = findTool(getTools(), 'recall_timeline');
    await t.handler({ project: 'x', days: 30 });
    expect(capturedCalls[0]!.url).toContain('days=30');
  });
});

// ---------------------------------------------------------------------------
// Suite: recall_compile
// ---------------------------------------------------------------------------

describe('recall_compile', () => {
  it('requires "project" in inputSchema.required', () => {
    const t = findTool(getTools(), 'recall_compile');
    expect(t.inputSchema.required).toContain('project');
  });

  it('handler issues a POST request', async () => {
    const t = findTool(getTools(), 'recall_compile');
    await t.handler({ project: 'myproj' });
    expect(capturedCalls[0]!.init?.method).toBe('POST');
  });

  it('handler calls /api/compilation/trigger', async () => {
    const t = findTool(getTools(), 'recall_compile');
    await t.handler({ project: 'myproj' });
    expect(capturedCalls[0]!.url).toContain('/api/compilation/trigger');
  });

  it('handler sends project in JSON body', async () => {
    const t = findTool(getTools(), 'recall_compile');
    await t.handler({ project: 'myproj' });
    const body = JSON.parse(capturedCalls[0]!.init?.body as string);
    expect(body.project).toBe('myproj');
  });

  it('handler sets Content-Type application/json', async () => {
    const t = findTool(getTools(), 'recall_compile');
    await t.handler({ project: 'myproj' });
    const headers = capturedCalls[0]!.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ---------------------------------------------------------------------------
// Suite: recall_dashboard
// ---------------------------------------------------------------------------

describe('recall_dashboard', () => {
  it('requires "project" in inputSchema.required', () => {
    const t = findTool(getTools(), 'recall_dashboard');
    expect(t.inputSchema.required).toContain('project');
  });

  it('handler calls /api/dashboard with project param', async () => {
    const t = findTool(getTools(), 'recall_dashboard');
    await t.handler({ project: 'dash-proj' });
    expect(capturedCalls[0]!.url).toContain('/api/dashboard');
    expect(capturedCalls[0]!.url).toContain('project=dash-proj');
  });
});

// ---------------------------------------------------------------------------
// Suite: recall_kg_query
// ---------------------------------------------------------------------------

describe('recall_kg_query', () => {
  it('requires "project" in inputSchema.required', () => {
    const t = findTool(getTools(), 'recall_kg_query');
    expect(t.inputSchema.required).toContain('project');
  });

  it('entityName property has type string', () => {
    const t = findTool(getTools(), 'recall_kg_query');
    expect(t.inputSchema.properties.entityName.type).toBe('string');
  });

  it('handler calls /api/search with project param', async () => {
    const t = findTool(getTools(), 'recall_kg_query');
    await t.handler({ project: 'kg-proj', entityName: 'AuthService' });
    expect(capturedCalls[0]!.url).toContain('/api/search');
    expect(capturedCalls[0]!.url).toContain('project=kg-proj');
  });

  it('handler includes entityName as q param', async () => {
    const t = findTool(getTools(), 'recall_kg_query');
    await t.handler({ project: 'kg-proj', entityName: 'UserModel' });
    expect(capturedCalls[0]!.url).toContain('q=UserModel');
  });

  it('handler falls back to empty q when entityName is omitted', async () => {
    const t = findTool(getTools(), 'recall_kg_query');
    await t.handler({ project: 'kg-proj' });
    expect(capturedCalls[0]!.url).toContain('q=');
  });
});

// ---------------------------------------------------------------------------
// Suite: base URL configuration
// ---------------------------------------------------------------------------

describe('RecallMcpTools — base URL configuration', () => {
  it('uses the provided base URL for all tools', async () => {
    const customBase = 'http://custom-host:9999';
    const tools = createRecallTools(customBase);

    // recall_search
    await findTool(tools, 'recall_search').handler({ query: 'test' });
    expect(capturedCalls.at(-1)!.url).toStartWith(customBase);

    // recall_timeline
    await findTool(tools, 'recall_timeline').handler({ project: 'p' });
    expect(capturedCalls.at(-1)!.url).toStartWith(customBase);

    // recall_compile (POST)
    await findTool(tools, 'recall_compile').handler({ project: 'p' });
    expect(capturedCalls.at(-1)!.url).toStartWith(customBase);

    // recall_dashboard
    await findTool(tools, 'recall_dashboard').handler({ project: 'p' });
    expect(capturedCalls.at(-1)!.url).toStartWith(customBase);

    // recall_kg_query
    await findTool(tools, 'recall_kg_query').handler({ project: 'p' });
    expect(capturedCalls.at(-1)!.url).toStartWith(customBase);
  });
});
