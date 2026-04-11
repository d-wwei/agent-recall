/**
 * uninstall.ts — Remove agent-recall hooks from all detected platforms.
 *
 * Steps:
 *   1. Stop the worker service if running (graceful shutdown via HTTP)
 *   2. Remove hooks from every platform where they are currently registered
 *   3. Advise the user to manually delete the data directory (never auto-deleted)
 */

import { join } from 'path';
import { homedir } from 'os';
import { PLATFORMS } from '../lib/platform-detect.js';
import { isHooksRegistered, removeHooks } from '../lib/hook-register.js';
import { checkWorkerRunning } from '../lib/runtime-check.js';
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';

const AGENT_RECALL_ROOT = join(homedir(), '.agent-recall');
const WORKER_SHUTDOWN_URL = 'http://127.0.0.1:37777/api/admin/shutdown';
const HTTP_TIMEOUT_MS = 5000;

// ─── Step 1: Stop worker ─────────────────────────────────────────────────────

async function stopWorker(): Promise<void> {
  log(formatHeader('Stopping Worker'));
  log('');

  const workerResult = await checkWorkerRunning();
  if (!workerResult.ok) {
    log(formatSkip('Worker not running — skipping shutdown'));
    log('');
    return;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      await fetch(WORKER_SHUTDOWN_URL, {
        method: 'POST',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    log(formatCheck('Worker shutdown signal sent'));
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // A connection reset / ECONNRESET after sending shutdown is expected —
    // the process exits before it can send an HTTP response.
    const isExpectedDisconnect =
      msg.includes('ECONNRESET') ||
      msg.includes('socket hang up') ||
      msg.includes('abort') ||
      msg.includes('ECONNREFUSED');

    if (isExpectedDisconnect) {
      log(formatCheck('Worker stopped (connection closed)'));
    } else {
      log(formatFail('Could not stop worker', msg));
    }
  }

  log('');
}

// ─── Step 2: Remove hooks ─────────────────────────────────────────────────────

function removeAllHooks(): void {
  log(formatHeader('Removing Hooks'));
  log('');

  let removedCount = 0;

  for (const platform of PLATFORMS) {
    const target = platform.getHooksTarget(AGENT_RECALL_ROOT);

    if (!isHooksRegistered(target)) {
      log(formatSkip(`${platform.name} — not registered`));
      continue;
    }

    try {
      removeHooks(target);
      log(formatCheck(`${platform.name} — hooks removed`));
      removedCount++;
    } catch (err) {
      log(formatFail(
        `${platform.name} — failed to remove hooks`,
        (err as Error).message
      ));
    }
  }

  if (removedCount === 0) {
    log(formatSkip('No hooks were registered on any platform'));
  }

  log('');
}

// ─── Step 3: Data directory notice ───────────────────────────────────────────

function printDataDirNotice(): void {
  log(formatHeader('Data Directory'));
  log('');
  log(`  Your agent-recall data is stored at:`);
  log(`    ${AGENT_RECALL_ROOT}`);
  log('');
  log(`  This directory was NOT deleted to prevent accidental data loss.`);
  log(`  To fully remove agent-recall, delete it manually:`);
  log('');
  log(`    rm -rf ${AGENT_RECALL_ROOT}`);
  log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  log('');
  await stopWorker();
  removeAllHooks();
  printDataDirNotice();
}
