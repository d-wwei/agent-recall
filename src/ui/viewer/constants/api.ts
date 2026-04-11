/**
 * API endpoint paths
 * Centralized to avoid magic strings scattered throughout the codebase
 */
export const API_ENDPOINTS = {
  OBSERVATIONS: '/api/observations',
  SUMMARIES: '/api/summaries',
  PROMPTS: '/api/prompts',
  SETTINGS: '/api/settings',
  STATS: '/api/stats',
  PROCESSING_STATUS: '/api/processing-status',
  STREAM: '/stream',
  DASHBOARD: '/api/dashboard',
  DASHBOARD_SUMMARY: '/api/dashboard/summary',
  COMPILATION_STATS: '/api/compilation/stats',
  COMPILATION_LOGS: '/api/compilation/logs',
  COMPILATION_DIAGRAMS: '/api/compilation/diagrams',
} as const;
