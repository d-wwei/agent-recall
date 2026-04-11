/**
 * RecallMcpTools — Native MCP tool definitions for Agent Recall (8.1)
 *
 * Exports McpToolDefinition objects that wrap the Worker HTTP API.
 * These can be registered with any MCP server that follows the
 * ModelContextProtocol tool contract.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, any>;  // JSON Schema
  handler: (args: Record<string, any>) => Promise<any>;
}

/**
 * Create the five recall-specific MCP tool definitions.
 *
 * @param workerBaseUrl  Base URL of the Worker HTTP API (e.g. "http://localhost:37777")
 */
export function createRecallTools(workerBaseUrl: string): McpToolDefinition[] {
  return [
    {
      name: 'recall_search',
      description: 'Search Agent Recall memory (FTS5 + SeekDB vector fusion)',
      inputSchema: {
        type: 'object',
        properties: {
          query:   { type: 'string', description: 'Search query' },
          project: { type: 'string', description: 'Project name filter' },
          limit:   { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const params = new URLSearchParams({ q: args['query'] as string, limit: String(args['limit'] ?? 10) });
        if (args['project']) params.set('project', args['project'] as string);
        const res = await fetch(`${workerBaseUrl}/api/search?${params}`);
        return res.json();
      },
    },
    {
      name: 'recall_timeline',
      description: 'Get observation timeline for a project',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
          days:    { type: 'number', description: 'Days of history (default 7)' },
        },
        required: ['project'],
      },
      handler: async (args) => {
        const params = new URLSearchParams({ project: args['project'] as string, days: String(args['days'] ?? 7) });
        const res = await fetch(`${workerBaseUrl}/api/timeline?${params}`);
        return res.json();
      },
    },
    {
      name: 'recall_compile',
      description: 'Trigger knowledge compilation for a project',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
        },
        required: ['project'],
      },
      handler: async (args) => {
        const res = await fetch(`${workerBaseUrl}/api/compilation/trigger`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: args['project'] }),
        });
        return res.json();
      },
    },
    {
      name: 'recall_dashboard',
      description: 'Get memory health dashboard metrics',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project name' },
        },
        required: ['project'],
      },
      handler: async (args) => {
        const params = new URLSearchParams({ project: args['project'] as string });
        const res = await fetch(`${workerBaseUrl}/api/dashboard?${params}`);
        return res.json();
      },
    },
    {
      name: 'recall_kg_query',
      description: 'Query the knowledge graph for entities and facts',
      inputSchema: {
        type: 'object',
        properties: {
          entityName: { type: 'string', description: 'Entity name to look up' },
          entityType: { type: 'string', description: 'Entity type filter' },
          project:    { type: 'string', description: 'Project scope' },
        },
        required: ['project'],
      },
      handler: async (args) => {
        // Direct DB query through worker API would be ideal.
        // For now, search observations by entity name.
        const params = new URLSearchParams({
          q:       (args['entityName'] as string | undefined) ?? '',
          project: args['project'] as string,
        });
        const res = await fetch(`${workerBaseUrl}/api/search?${params}`);
        return res.json();
      },
    },
  ];
}
