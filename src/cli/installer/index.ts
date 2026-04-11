/**
 * index.ts — CLI entry point for `npx agent-recall`
 *
 * Compiled by esbuild to bin/agent-recall.cjs with a #!/usr/bin/env node banner.
 *
 * Responsibilities:
 *  - Parse process.argv for command + flags
 *  - Dispatch to command modules via dynamic import
 *  - Print help / version
 *  - Exit 1 on unknown command
 *
 * Design notes:
 * - Command modules are loaded lazily so startup is fast and missing modules
 *   produce a clear error rather than a broken require() at load time.
 * - __DEFAULT_PACKAGE_VERSION__ is replaced at build time by esbuild's
 *   `define` option (e.g. define: { __DEFAULT_PACKAGE_VERSION__: '"1.2.3"' }).
 */

declare const __DEFAULT_PACKAGE_VERSION__: string;

import { formatBanner, formatFail, log } from './lib/output.js';

// ─── Command registry ────────────────────────────────────────────────────────

/**
 * Map of CLI sub-command names to their loader functions.
 * Each loader dynamically imports the command module and calls run().
 *
 * Command modules are in src/cli/installer/commands/<cmd>.ts and
 * compiled to the corresponding .js path at build time.
 */
const COMMANDS: Record<string, () => Promise<void>> = {
  install:   () => import('./commands/install.js').then(m => m.run()),
  doctor:    () => import('./commands/doctor.js').then(m => m.run()),
  adapter:   () => import('./commands/adapter.js').then(m => m.run()),
  status:    () => import('./commands/status.js').then(m => m.run()),
  uninstall: () => import('./commands/uninstall.js').then(m => m.run()),
};

// ─── Help text ───────────────────────────────────────────────────────────────

function showHelp(): void {
  const version = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined'
    ? __DEFAULT_PACKAGE_VERSION__
    : 'unknown';

  log('');
  log(formatBanner() + `  v${version}`);
  log('');
  log('  Persistent memory system for Claude Code');
  log('');
  log('Usage:');
  log('  npx agent-recall <command> [options]');
  log('');
  log('Commands:');
  log('  install    Install hooks and configure agent-recall');
  log('  doctor     Check installation health');
  log('  adapter    Manage editor adapter integrations');
  log('  status     Show current status and configuration');
  log('  uninstall  Remove hooks and configuration');
  log('');
  log('Options:');
  log('  --help     Show this help message');
  log('  --version  Show version number');
  log('');
  log('Examples:');
  log('  npx agent-recall install');
  log('  npx agent-recall doctor');
  log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  const command = positional[0];

  // --version
  if (flags.has('--version')) {
    const version = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined'
      ? __DEFAULT_PACKAGE_VERSION__
      : 'unknown';
    log(version);
    return;
  }

  // --help or no command
  if (flags.has('--help') || !command) {
    showHelp();
    return;
  }

  // Dispatch to command module
  const loader = COMMANDS[command];
  if (!loader) {
    log(formatFail(`Unknown command: ${command}`, `Run 'npx agent-recall --help' to see available commands`));
    process.exit(1);
  }

  await loader();
}

// Run when executed directly (not imported as a module in tests).
// Check both CJS (compiled bundle) and ESM (source / ts-node) environments.
const _isMain = typeof require !== 'undefined' && typeof module !== 'undefined'
  ? require.main === module || !module.parent
  : import.meta.url === `file://${process.argv[1]}`;

if (_isMain) {
  main().catch(err => {
    log(formatFail(String(err)));
    process.exit(1);
  });
}
