/**
 * adapter.ts — Subcommands for managing platform hook adapters.
 *
 * Subcommands:
 *   list                  — Show detected status and hooks registration status for each platform
 *   install <platform>    — Register hooks for a specific platform
 *   remove  <platform>    — Remove hooks for a specific platform
 */

import { join } from 'path';
import { homedir } from 'os';
import { PLATFORMS, getPlatformById } from '../lib/platform-detect.js';
import { registerHooks, isHooksRegistered, removeHooks } from '../lib/hook-register.js';
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';

/** The installed agent-recall data root used for resolving hook source paths. */
const AGENT_RECALL_ROOT = join(homedir(), '.agent-recall');

// ─── Subcommand: list ────────────────────────────────────────────────────────

function runList(): void {
  log(formatHeader('Platform Adapters'));
  log('');

  for (const platform of PLATFORMS) {
    const detected = platform.detect();
    const target = platform.getHooksTarget(AGENT_RECALL_ROOT);
    const registered = isHooksRegistered(target);

    const detectedLabel = detected ? 'detected' : 'not detected';
    const registeredLabel = registered ? 'hooks registered' : 'hooks not registered';

    if (!detected) {
      log(formatSkip(`${platform.name} — ${detectedLabel}`));
    } else if (registered) {
      log(formatCheck(`${platform.name} — ${detectedLabel}, ${registeredLabel}`));
    } else {
      log(formatFail(
        `${platform.name} — ${detectedLabel}, ${registeredLabel}`,
        `Run: npx agent-recall adapter install ${platform.id}`
      ));
    }
  }

  log('');
}

// ─── Subcommand: install ─────────────────────────────────────────────────────

function runInstall(platformId: string): void {
  const platform = getPlatformById(platformId);
  if (!platform) {
    log(formatFail(
      `Unknown platform: ${platformId}`,
      `Valid IDs: ${PLATFORMS.map((p) => p.id).join(', ')}`
    ));
    process.exit(1);
  }

  const source = platform.getHooksSource(AGENT_RECALL_ROOT);
  const target = platform.getHooksTarget(AGENT_RECALL_ROOT);

  if (isHooksRegistered(target)) {
    log(formatSkip(`${platform.name} — hooks already registered at ${target}`));
    return;
  }

  try {
    registerHooks(AGENT_RECALL_ROOT, source, target);
    log(formatCheck(`${platform.name} — hooks registered at ${target}`));
  } catch (err) {
    log(formatFail(
      `${platform.name} — failed to register hooks`,
      (err as Error).message
    ));
    process.exit(1);
  }
}

// ─── Subcommand: remove ──────────────────────────────────────────────────────

function runRemove(platformId: string): void {
  const platform = getPlatformById(platformId);
  if (!platform) {
    log(formatFail(
      `Unknown platform: ${platformId}`,
      `Valid IDs: ${PLATFORMS.map((p) => p.id).join(', ')}`
    ));
    process.exit(1);
  }

  const target = platform.getHooksTarget(AGENT_RECALL_ROOT);

  if (!isHooksRegistered(target)) {
    log(formatSkip(`${platform.name} — hooks not registered, nothing to remove`));
    return;
  }

  try {
    removeHooks(target);
    log(formatCheck(`${platform.name} — hooks removed from ${target}`));
  } catch (err) {
    log(formatFail(
      `${platform.name} — failed to remove hooks`,
      (err as Error).message
    ));
    process.exit(1);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Main entry point for the `adapter` command.
 * argv is the slice of process.argv starting after the subcommand name.
 * e.g. for `npx agent-recall adapter install claude-code`, argv = ['install', 'claude-code']
 */
export async function run(argv: string[] = []): Promise<void> {
  const [sub, platformId] = argv;

  switch (sub) {
    case 'list':
    case undefined:
      runList();
      break;

    case 'install':
      if (!platformId) {
        log(formatFail('Missing platform ID', `Usage: agent-recall adapter install <platform>`));
        log(`Available platforms: ${PLATFORMS.map((p) => p.id).join(', ')}`);
        process.exit(1);
      }
      runInstall(platformId);
      break;

    case 'remove':
      if (!platformId) {
        log(formatFail('Missing platform ID', `Usage: agent-recall adapter remove <platform>`));
        log(`Available platforms: ${PLATFORMS.map((p) => p.id).join(', ')}`);
        process.exit(1);
      }
      runRemove(platformId);
      break;

    default:
      log(formatFail(
        `Unknown adapter subcommand: ${sub}`,
        'Usage: agent-recall adapter [list | install <platform> | remove <platform>]'
      ));
      process.exit(1);
  }
}
