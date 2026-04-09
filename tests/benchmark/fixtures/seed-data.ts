/**
 * Benchmark seed data — populates an in-memory SessionStore with
 * 10-15 diverse observations so the benchmark runner has something to search.
 *
 * Returns a Map from concept-key → observation ID so the benchmark
 * can build expected result sets.
 */

import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';

export type SeedResult = Map<string, number>;

interface ObservationSpec {
  key: string;
  type: string;
  title: string;
  subtitle: string | null;
  facts: string[];
  narrative: string;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
}

const OBSERVATIONS: ObservationSpec[] = [
  // Auth domain
  {
    key: 'auth-jwt-decision',
    type: 'decision',
    title: 'Switch to JWT-based authentication',
    subtitle: 'Auth architecture decision',
    facts: [
      'Decided to use JWT tokens for stateless auth',
      'Access tokens expire in 15 minutes',
      'Refresh tokens stored in HttpOnly cookies',
      'ERR_AUTH_TOKEN_EXPIRED is the error code for expired tokens',
    ],
    narrative:
      'The team decided to migrate from session-based to JWT authentication to support horizontal scaling. The new approach uses short-lived access tokens (15 min) with refresh token rotation.',
    concepts: ['auth', 'jwt', 'token', 'login', 'ERR_AUTH_TOKEN_EXPIRED'],
    files_read: ['src/auth/session.ts'],
    files_modified: ['src/auth/jwt.ts', 'src/auth/middleware.ts'],
  },
  {
    key: 'auth-refactor-change',
    type: 'refactor',
    title: 'Refactored auth middleware to use new JWT helpers',
    subtitle: 'Code cleanup',
    facts: [
      'Extracted token verification into validateToken() helper',
      'Removed legacy session cookie logic',
      'Added unit tests for token expiry edge cases',
    ],
    narrative:
      'Refactored the authentication middleware following the JWT migration decision. The validateToken helper centralises token verification logic and makes error handling consistent.',
    concepts: ['auth', 'refactor', 'jwt', 'middleware', 'suggestion'],
    files_read: ['src/auth/middleware.ts'],
    files_modified: ['src/auth/middleware.ts', 'src/auth/helpers.ts'],
  },

  // Database domain
  {
    key: 'database-schema-discovery',
    type: 'discovery',
    title: 'SessionStore SQLite schema structure discovered',
    subtitle: 'Database exploration',
    facts: [
      'SessionStore uses 6 core tables: sdk_sessions, observations, session_summaries, user_prompts, schema_versions, pending_messages',
      'All tables use INTEGER PRIMARY KEY AUTOINCREMENT',
      'Foreign key constraints use ON DELETE CASCADE ON UPDATE CASCADE',
      'WAL journal mode enabled for concurrent reads',
    ],
    narrative:
      'Explored the SessionStore database schema. The schema is versioned through a schema_versions table and migrations are applied incrementally on startup.',
    concepts: ['database', 'schema', 'sqlite', 'migration', 'SessionStore'],
    files_read: ['src/services/sqlite/SessionStore.ts', 'src/services/sqlite/migrations.ts'],
    files_modified: [],
  },
  {
    key: 'database-migration-feature',
    type: 'feature',
    title: 'Added observation content_hash deduplication migration',
    subtitle: 'Database migration 23',
    facts: [
      'Added content_hash column to observations table',
      'Hash computed from memory_session_id + title + narrative',
      'Deduplication window is 30 seconds',
      'Migration is applied via MigrationRunner',
    ],
    narrative:
      'Implemented content-hash based deduplication for observations to prevent duplicate storage during rapid tool use. The 30-second window catches retry bursts without losing genuine re-discoveries.',
    concepts: ['database', 'migration', 'schema', 'deduplication', 'storeObservation'],
    files_read: ['src/services/sqlite/SessionStore.ts'],
    files_modified: ['src/services/sqlite/migrations/runner.ts', 'src/services/sqlite/SessionStore.ts'],
  },

  // API domain
  {
    key: 'api-rate-limit-decision',
    type: 'decision',
    title: 'Implement per-user rate limiting on search API',
    subtitle: 'API design decision',
    facts: [
      'Rate limit: 100 requests per minute per API key',
      'Sliding window algorithm chosen over token bucket',
      'Rate limit headers added: X-RateLimit-Limit, X-RateLimit-Remaining',
      '429 response includes Retry-After header',
    ],
    narrative:
      'Decided to add rate limiting to the search API endpoints after observing high traffic spikes. The sliding window algorithm provides smoother limiting than token bucket for bursty workloads.',
    concepts: ['api', 'rate-limit', 'throttle', 'recommendation'],
    files_read: ['src/services/worker/http/routes/SearchRoutes.ts'],
    files_modified: ['src/services/worker/http/middleware/RateLimiter.ts'],
  },
  {
    key: 'api-env-config-change',
    type: 'change',
    title: 'Move API configuration to environment variables',
    subtitle: 'Configuration management',
    facts: [
      'AGENT_RECALL_PORT now configures worker port (default 37777)',
      'AGENT_RECALL_CHROMA_URL configures ChromaDB endpoint',
      'AGENT_RECALL_LOG_LEVEL controls log verbosity',
      'All env vars documented in README',
    ],
    narrative:
      'Migrated hardcoded API configuration values to environment variables following the 12-factor app pattern. This makes the service easier to configure in different deployment environments.',
    concepts: ['environment', 'config', 'api', 'suggestion', 'deployment'],
    files_read: ['src/shared/paths.ts'],
    files_modified: ['src/shared/paths.ts', 'src/services/worker-service.ts'],
  },

  // Testing domain
  {
    key: 'testing-preference-discovery',
    type: 'discovery',
    title: 'Project uses Bun test runner with no mocks policy',
    subtitle: 'Testing conventions discovered',
    facts: [
      'bun:test is the exclusive test runner',
      'Prefer real SQLite :memory: databases over mocks',
      'Test files follow *.test.ts naming convention',
      'Mock usage is documented in each test file with justification',
    ],
    narrative:
      'Discovered the project testing conventions: Bun test runner with a strong preference for real implementations over mocks. The no-mock policy makes tests more reliable at the cost of slightly slower execution.',
    concepts: ['testing', 'bun', 'jest', 'tools', 'preference', 'convention'],
    files_read: ['tests/session_store.test.ts', 'tests/sqlite/sessions.test.ts'],
    files_modified: [],
  },
  {
    key: 'testing-coverage-feature',
    type: 'feature',
    title: 'Added 461 new tests for SQLite module coverage',
    subtitle: 'Test expansion',
    facts: [
      '461 tests added across 12 new test files',
      'Coverage targets: sessions, observations, summaries, prompts, transactions',
      'Each module has dedicated test file in tests/sqlite/',
      'Integration tests validate cross-module behaviour',
    ],
    narrative:
      'Expanded the test suite with 461 new tests following the modular refactor. Tests validate CRUD operations, edge cases, and concurrency behaviour for all SQLite modules.',
    concepts: ['testing', 'coverage', 'sqlite', 'bun'],
    files_read: [],
    files_modified: [
      'tests/sqlite/sessions.test.ts',
      'tests/sqlite/observations.test.ts',
      'tests/sqlite/summaries.test.ts',
    ],
  },

  // Deployment domain
  {
    key: 'deployment-docker-decision',
    type: 'decision',
    title: 'Adopt Docker Compose for local development setup',
    subtitle: 'Deployment strategy',
    facts: [
      'Docker Compose chosen for local dev (ChromaDB + worker)',
      'ChromaDB runs on port 8000 in development',
      'Worker service port 37777 exposed via compose',
      'Volume mounts preserve data across restarts',
    ],
    narrative:
      'Decided to use Docker Compose to standardise the local development environment. This ensures developers have consistent ChromaDB access without manual installation.',
    concepts: ['deployment', 'docker', 'ci-cd', 'environment'],
    files_read: ['docker-compose.yml'],
    files_modified: ['docker-compose.yml', '.env.example'],
  },
  {
    key: 'deployment-ci-change',
    type: 'change',
    title: 'Added CI test pipeline with environment-conditional test exclusions',
    subtitle: 'CI/CD update',
    facts: [
      'GitHub Actions workflow added',
      'Tests requiring ChromaDB are excluded in CI (SKIP_CHROMA_TESTS=true)',
      'Bun test runs all unit and integration tests',
      'Test results published as workflow artifacts',
    ],
    narrative:
      'Set up a GitHub Actions CI pipeline that runs the full test suite. ChromaDB-dependent tests are conditionally skipped in CI to avoid the overhead of spinning up the vector store.',
    concepts: ['deployment', 'ci-cd', 'testing', 'docker'],
    files_read: ['.github/workflows/test.yml'],
    files_modified: ['.github/workflows/test.yml'],
  },

  // Preferences domain
  {
    key: 'typescript-style-preference',
    type: 'discovery',
    title: 'TypeScript coding conventions for this project',
    subtitle: 'Style preferences documented',
    facts: [
      'Prefer explicit return types on public methods',
      'Use type over interface for simple object shapes',
      'No any type — use unknown and narrow',
      'Prefer const assertions over enum for small sets',
    ],
    narrative:
      'Documented the TypeScript style conventions used consistently in this codebase. These preferences lean toward explicitness and avoid runtime overhead from enums.',
    concepts: ['typescript', 'style', 'preference', 'convention'],
    files_read: ['tsconfig.json'],
    files_modified: [],
  },
  {
    key: 'error-handling-preference',
    type: 'discovery',
    title: 'Preferred error handling patterns in the codebase',
    subtitle: 'Error handling conventions',
    facts: [
      'Use typed error classes (extends Error) for domain errors',
      'Never swallow errors silently — always log at minimum',
      'exit(1) for non-blocking, exit(2) for blocking errors',
      'try-catch only at module boundaries, not deep inside logic',
    ],
    narrative:
      'Identified consistent error handling patterns across the codebase. The exit code convention (1=warn, 2=block) is central to Claude Code hook integration.',
    concepts: ['error-handling', 'try-catch', 'preference', 'convention'],
    files_read: ['src/hooks/session-end.ts'],
    files_modified: [],
  },

  // Performance domain
  {
    key: 'performance-optimization-discovery',
    type: 'discovery',
    title: 'WAL mode and synchronous=NORMAL provide 3x write throughput',
    subtitle: 'SQLite performance discovery',
    facts: [
      'WAL mode allows concurrent readers during writes',
      'synchronous=NORMAL safe for non-critical data',
      'Prepared statements reused via this.db.prepare()',
      'Batch inserts 10x faster than individual inserts',
    ],
    narrative:
      'Discovered that enabling WAL mode with NORMAL synchronous pragma provides approximately 3x write throughput compared to default SQLite settings, while maintaining crash safety for the use case.',
    concepts: ['performance', 'optimization', 'sqlite', 'database'],
    files_read: ['src/services/sqlite/SessionStore.ts'],
    files_modified: [],
  },
  {
    key: 'createSDKSession-bugfix',
    type: 'bugfix',
    title: 'Fixed createSDKSession returning wrong ID for duplicate sessions',
    subtitle: 'Session ID threading bug',
    facts: [
      'Bug: INSERT OR IGNORE returned 0 for lastInsertRowid on ignored rows',
      'Fix: explicit SELECT after INSERT to get correct ID',
      'Affected multi-terminal sessions using same content_session_id',
      'Added regression test to session_store.test.ts',
    ],
    narrative:
      'Fixed a critical bug where createSDKSession returned 0 as the session ID when the INSERT was ignored (duplicate content_session_id). The fix uses a SELECT to fetch the real ID in all cases.',
    concepts: ['bugfix', 'fix', 'error', 'session', 'createSDKSession', 'database'],
    files_read: ['src/services/sqlite/SessionStore.ts'],
    files_modified: ['src/services/sqlite/SessionStore.ts'],
  },
];

export function seedBenchmarkData(store: SessionStore, project: string): SeedResult {
  const idMap: SeedResult = new Map();

  // Create benchmark session
  const contentSessionId = `benchmark-content-${Date.now()}`;
  const memorySessionId = `benchmark-memory-${Date.now()}`;

  const sessionDbId = store.createSDKSession(
    contentSessionId,
    project,
    'Benchmark seed session'
  );

  // Register the memory session ID (required for FK constraint on observations)
  store.updateMemorySessionId(sessionDbId, memorySessionId);

  // Insert all observations
  let promptNum = 1;
  for (const spec of OBSERVATIONS) {
    const result = store.storeObservation(
      memorySessionId,
      project,
      {
        type: spec.type,
        title: spec.title,
        subtitle: spec.subtitle,
        facts: spec.facts,
        narrative: spec.narrative,
        concepts: spec.concepts,
        files_read: spec.files_read,
        files_modified: spec.files_modified,
      },
      promptNum++,
      0
    );

    idMap.set(spec.key, result.id);

    // Also index by primary concept for query lookup
    for (const concept of spec.concepts) {
      if (!idMap.has(concept)) {
        idMap.set(concept, result.id);
      }
    }
  }

  return idMap;
}
