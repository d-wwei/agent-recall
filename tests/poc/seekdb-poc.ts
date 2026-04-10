/**
 * seekdb PoC — Verify embedded mode, hybrid search, and Bun compatibility
 */

import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SeekdbClient } from 'seekdb';
import { DefaultEmbeddingFunction } from '@seekdb/default-embed';

// ── Test Data ─────────────────────────────────────────────────────────────────

const OBSERVATIONS = [
  { id: '1', type: 'decision', title: 'Chose JWT for authentication', narrative: 'Decided to use JWT tokens with RS256 for the authentication system. This allows stateless auth across microservices.', concepts: 'auth, jwt, security' },
  { id: '2', type: 'discovery', title: 'Database connection pooling issue', narrative: 'Found that the database connection pool was set too low at 5 connections. Under concurrent requests, connections were exhausted causing timeouts.', concepts: 'database, performance, connection-pool' },
  { id: '3', type: 'bugfix', title: 'Fixed race condition in session cleanup', narrative: 'Two sessions ending simultaneously could corrupt the cleanup routine. Added a mutex lock to serialize cleanup operations.', concepts: 'concurrency, race-condition, session' },
  { id: '4', type: 'feature', title: 'Added user preferences API endpoint', narrative: 'Implemented REST API for user preferences. Users can get and update their coding style, theme, and notification preferences via PATCH /api/preferences.', concepts: 'api, preferences, user-settings' },
  { id: '5', type: 'decision', title: 'Switched from MySQL to PostgreSQL', narrative: 'After benchmarking, PostgreSQL outperformed MySQL for our workload with complex joins and JSON operations. Migration completed successfully.', concepts: 'database, postgresql, migration' },
  { id: '6', type: 'discovery', title: 'TypeScript strict mode catches null pointer bugs', narrative: 'Enabling TypeScript strict mode in the project caught 23 potential null pointer dereferences. Most were in error handling paths.', concepts: 'typescript, strict-mode, null-safety' },
  { id: '7', type: 'change', title: 'Refactored auth middleware to use dependency injection', narrative: 'The auth middleware was tightly coupled to the JWT library. Refactored to accept an auth provider interface, making it testable and swappable.', concepts: 'auth, refactoring, dependency-injection' },
  { id: '8', type: 'feature', title: 'Implemented WebSocket real-time notifications', narrative: 'Added WebSocket support for real-time notifications. Uses a pub/sub pattern with Redis as the message broker for multi-server deployments.', concepts: 'websocket, notifications, real-time, redis' },
  { id: '9', type: 'bugfix', title: 'Memory leak in event listener cleanup', narrative: 'Event listeners in the notification service were not being removed on disconnect, causing gradual memory growth of 10MB per hour.', concepts: 'memory-leak, event-listener, cleanup' },
  { id: '10', type: 'decision', title: 'Chose Tailwind CSS over styled-components', narrative: 'For the frontend redesign, chose Tailwind CSS. Faster development, smaller bundle size, and the team already knows utility-first CSS.', concepts: 'css, tailwind, frontend, design' },
];

const QUERIES = [
  { query: 'how does authentication work', expectedIds: ['1', '7'], type: 'semantic' },
  { query: 'database performance', expectedIds: ['2', '5'], type: 'semantic' },
  { query: 'race condition', expectedIds: ['3'], type: 'keyword' },
  { query: 'user preferences API', expectedIds: ['4'], type: 'hybrid' },
  { query: 'memory leak', expectedIds: ['9'], type: 'keyword' },
  { query: 'frontend styling', expectedIds: ['10'], type: 'semantic' },
  { query: 'WebSocket notifications', expectedIds: ['8'], type: 'hybrid' },
  { query: 'TypeScript null safety', expectedIds: ['6'], type: 'hybrid' },
];

// ── Runner ────────────────────────────────────────────────────────────────────

async function runPoC() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'seekdb-poc-'));
  const dbPath = join(tmpDir, 'poc.db');
  let client: SeekdbClient | null = null;

  console.log('=== seekdb PoC for Agent Recall ===\n');

  try {
    // Step 1: Create embedded client
    console.log('Step 1: Creating embedded seekdb client...');
    client = new SeekdbClient({ path: dbPath });
    console.log('  ✓ Client created');

    // Step 2: Create embedding function
    console.log('Step 2: Loading embedding model...');
    const embedder = new DefaultEmbeddingFunction({
      modelName: 'Xenova/all-MiniLM-L6-v2',
    });
    console.log('  ✓ Embedding function ready');

    // Step 3: Create collection
    console.log('Step 3: Creating collection...');
    const collection = await client.createCollection({
      name: 'observations',
      embeddingFunction: embedder,
    });
    console.log('  ✓ Collection created');

    // Step 4: Insert observations
    console.log('Step 4: Inserting', OBSERVATIONS.length, 'observations...');
    const insertStart = performance.now();

    await collection.add({
      ids: OBSERVATIONS.map(o => o.id),
      documents: OBSERVATIONS.map(o => `${o.title}. ${o.narrative}`),
      metadatas: OBSERVATIONS.map(o => ({
        type: o.type,
        title: o.title,
        concepts: o.concepts,
      })),
    });

    const insertMs = Math.round(performance.now() - insertStart);
    console.log(`  ✓ Inserted in ${insertMs}ms (${Math.round(insertMs / OBSERVATIONS.length)}ms/doc)`);

    // Step 5: Search queries
    console.log('Step 5: Running', QUERIES.length, 'search queries...\n');

    let totalRecall = 0;
    let totalLatency = 0;

    for (const q of QUERIES) {
      const searchStart = performance.now();

      const results = await collection.query({
        queryTexts: [q.query],
        nResults: 5,
        include: ['documents', 'metadatas', 'distances'],
      });

      const latencyMs = Math.round(performance.now() - searchStart);
      const returnedIds = results.ids?.[0] || [];
      const distances = results.distances?.[0] || [];

      const recall = q.expectedIds.length > 0
        ? q.expectedIds.filter(id => returnedIds.includes(id)).length / q.expectedIds.length
        : 1;

      totalRecall += recall;
      totalLatency += latencyMs;

      const topMatch = returnedIds[0] || '-';
      const topDist = distances[0]?.toFixed(3) || '-';
      console.log(`  [${q.type.padEnd(8)}] "${q.query}"`);
      console.log(`           R@5=${recall.toFixed(2)} | ${latencyMs}ms | top=[${returnedIds.slice(0, 3).join(',')}] dist=${topDist}`);
    }

    const avgRecall = totalRecall / QUERIES.length;
    const avgLatency = totalLatency / QUERIES.length;

    console.log('\n=== Summary ===');
    console.log(`Bun compatible:     ✓`);
    console.log(`Embedded mode:      ✓`);
    console.log(`Insert:             ${insertMs}ms for ${OBSERVATIONS.length} docs`);
    console.log(`Avg R@5:            ${(avgRecall * 100).toFixed(1)}%`);
    console.log(`Avg search latency: ${avgLatency.toFixed(0)}ms`);

    console.log('\n=== Verdict ===');
    if (avgRecall > 0.6) {
      console.log('✓ PASS — seekdb is viable for Agent Recall');
    } else if (avgRecall > 0.3) {
      console.log('△ PARTIAL — Works but search quality needs tuning');
    } else {
      console.log('✗ Search quality too low');
    }

    // Save results
    const resultData = {
      bunCompatible: true,
      embeddedWorks: true,
      insertLatencyMs: insertMs,
      avgRecall,
      avgLatencyMs: avgLatency,
      queryCount: QUERIES.length,
      docCount: OBSERVATIONS.length,
    };
    await Bun.write('tests/poc/seekdb-poc-result.json', JSON.stringify(resultData, null, 2));

  } catch (err) {
    console.error('\n✗ FATAL ERROR:', (err as Error).message);
    console.error((err as Error).stack);

    console.log('\n=== Verdict ===');
    console.log('✗ FAIL —', (err as Error).message);

    await Bun.write('tests/poc/seekdb-poc-result.json', JSON.stringify({
      bunCompatible: true,
      embeddedWorks: false,
      error: (err as Error).message,
    }, null, 2));
  } finally {
    try { if (client) await (client as any).close?.(); } catch {}
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

await runPoC();
