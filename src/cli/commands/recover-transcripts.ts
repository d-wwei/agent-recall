/**
 * CLI command: recover-transcripts
 *
 * One-time import of Claude Code JSONL session files that were missed by hooks.
 * Scans ~/.claude/projects/ for JSONL files, checks each against the database,
 * and imports any sessions not already captured.
 *
 * Usage:
 *   agent-recall recover-transcripts [--path <glob>] [--project <name>] [--dry-run]
 */

import { readFileSync } from 'fs';
import { basename, join } from 'path';
import { globSync } from 'glob';
import { homedir } from 'os';
import { ClaudeCodeTranscriptProcessor } from '../../services/transcripts/claude-code-processor.js';
import { ensureWorkerRunning } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';

interface RecoverOptions {
  path?: string;
  project?: string;
  dryRun?: boolean;
}

const DEFAULT_GLOB = `${homedir()}/.claude/projects/**/*.jsonl`;
const UUID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/**
 * Check if a session already exists in the database via the worker API.
 * Returns true if the session has any user_prompts (hooks or previous import captured it).
 */
/** Direct SQLite check — no side effects, no HTTP calls */
function sessionExistsInDb(contentSessionId: string, dbPath: string): boolean {
  try {
    const { Database } = require('bun:sqlite');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT id FROM sdk_sessions WHERE content_session_id = ?').get(contentSessionId);
    db.close();
    return !!row;
  } catch {
    return false;
  }
}

export async function recoverTranscripts(options: RecoverOptions = {}): Promise<void> {
  const glob = options.path || DEFAULT_GLOB;
  const dryRun = options.dryRun ?? false;

  console.log(`Scanning: ${glob}`);
  if (dryRun) console.log('(dry run — no data will be written)');

  // Expand glob, filter to UUID-named JSONL files, exclude subagent files
  const allFiles = globSync(glob, { absolute: true });
  const sessionFiles = allFiles.filter(f => {
    const name = basename(f);
    if (!UUID_PATTERN.test(name)) return false;
    if (f.includes('/subagents/')) return false;
    return true;
  });

  console.log(`Found ${sessionFiles.length} session JSONL files`);

  const dbPath = join(homedir(), '.agent-recall', 'agent-recall.db');

  if (!dryRun) {
    // Ensure worker is running for database writes
    const workerReady = await ensureWorkerRunning();
    if (!workerReady) {
      console.error('Worker is not running. Start it first: agent-recall start');
      process.exit(1);
    }
  }

  let recovered = 0;
  let skipped = 0;
  let failed = 0;
  let totalObservations = 0;

  for (const filePath of sessionFiles) {
    const name = basename(filePath);
    const match = UUID_PATTERN.exec(name);
    if (!match) continue;
    const sessionId = match[1];

    // Check if already in database (direct SQLite, no side effects)
    if (sessionExistsInDb(sessionId, dbPath)) {
      skipped++;
      continue;
    }

    // Read and process the file
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.error(`  Failed to read ${name}: ${err}`);
      failed++;
      continue;
    }

    const lines = content.split('\n').filter(l => l.trim());

    // Count user messages to estimate size
    let userMessages = 0;
    let toolUses = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'user' && typeof obj.message?.content === 'string') userMessages++;
        if (obj.type === 'assistant') {
          const content = obj.message?.content;
          if (Array.isArray(content)) {
            toolUses += content.filter((c: any) => c.type === 'tool_use').length;
          }
        }
      } catch { /* skip malformed */ }
    }

    if (userMessages === 0) {
      skipped++;
      continue;
    }

    console.log(`  ${sessionId.slice(0, 8)}... ${userMessages} prompts, ${toolUses} tool calls${dryRun ? ' (would import)' : ''}`);

    if (dryRun) {
      recovered++;
      totalObservations += toolUses;
      continue;
    }

    // Process the file through ClaudeCodeTranscriptProcessor
    const processor = new ClaudeCodeTranscriptProcessor();
    let obsCount = 0;

    for (const line of lines) {
      try {
        await processor.processLine(line, sessionId);
        obsCount++;
      } catch (err) {
        logger.debug('TRANSCRIPT', `Error processing line in ${sessionId.slice(0, 8)}`, {
          correlationId: sessionId
        });
      }
    }

    // Finalize the session (triggers summary)
    try {
      await processor.finalizeSession(sessionId);
    } catch (err) {
      logger.debug('TRANSCRIPT', `Error finalizing ${sessionId.slice(0, 8)}`, {
        correlationId: sessionId
      });
    }

    recovered++;
    totalObservations += toolUses;
  }

  console.log();
  console.log(`Results:`);
  console.log(`  Recovered: ${recovered} sessions (${totalObservations} tool observations)`);
  console.log(`  Skipped:   ${skipped} (already in database or empty)`);
  if (failed > 0) console.log(`  Failed:    ${failed}`);
  if (dryRun) console.log(`  (dry run — nothing was written)`);
}
