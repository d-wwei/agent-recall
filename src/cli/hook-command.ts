import { readJsonFromStdin } from './stdin-reader.js';
import { getPlatformAdapter } from './adapters/index.js';
import { getEventHandler } from './handlers/index.js';
import { HOOK_EXIT_CODES } from '../shared/hook-constants.js';
import { logger } from '../utils/logger.js';

export interface HookCommandOptions {
  /** If true, don't call process.exit() - let caller handle process lifecycle */
  skipExit?: boolean;
}

/**
 * Classify whether an error indicates the worker is unavailable (graceful degradation)
 * vs a handler/client bug (blocking error that developers need to see).
 *
 * Exit 0 (graceful degradation):
 * - Transport failures: ECONNREFUSED, ECONNRESET, EPIPE, ETIMEDOUT, fetch failed
 * - Timeout errors: timed out, timeout
 * - Server errors: HTTP 5xx status codes
 *
 * Exit 2 (blocking error — handler/client bug):
 * - HTTP 4xx status codes (bad request, not found, validation error)
 * - Programming errors (TypeError, ReferenceError, SyntaxError)
 * - All other unexpected errors
 */
export function isWorkerUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Transport failures — worker unreachable
  const transportPatterns = [
    'econnrefused',
    'econnreset',
    'epipe',
    'etimedout',
    'enotfound',
    'econnaborted',
    'enetunreach',
    'ehostunreach',
    'fetch failed',
    'unable to connect',
    'socket hang up',
  ];
  if (transportPatterns.some(p => lower.includes(p))) return true;

  // Timeout errors — worker didn't respond in time
  if (lower.includes('timed out') || lower.includes('timeout')) return true;

  // HTTP 5xx server errors — worker has internal problems
  if (/failed:\s*5\d{2}/.test(message) || /status[:\s]+5\d{2}/.test(message)) return true;

  // HTTP 429 (rate limit) — treat as transient unavailability, not a bug
  if (/failed:\s*429/.test(message) || /status[:\s]+429/.test(message)) return true;

  // HTTP 4xx client errors — our bug, NOT worker unavailability
  if (/failed:\s*4\d{2}/.test(message) || /status[:\s]+4\d{2}/.test(message)) return false;

  // Programming errors — code bugs, not worker unavailability
  // Note: TypeError('fetch failed') already handled by transport patterns above
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return false;
  }

  // Default: treat unknown errors as blocking (conservative — surface bugs)
  return false;
}

/**
 * Auto-detect the actual platform from stdin fields when the command-line
 * platform argument doesn't match the real caller.
 *
 * This handles the common case where settings.json hooks use "claude-code"
 * but are also triggered by Cursor (which shares the same settings file).
 */
function autoDetectPlatform(declaredPlatform: string, rawInput: unknown): string {
  if (!rawInput || typeof rawInput !== 'object') return declaredPlatform;
  const r = rawInput as Record<string, unknown>;

  // Cursor: has cursor_version, or conversation_id without session_id
  if (r.cursor_version || (r.conversation_id && !r.session_id)) {
    return 'cursor';
  }

  // Gemini CLI: has hook_event_name matching gemini patterns, or GEMINI env vars
  if (r.hook_event_name && typeof r.hook_event_name === 'string' &&
      ['BeforeTool', 'AfterAgent', 'Notification'].includes(r.hook_event_name)) {
    return 'gemini-cli';
  }

  return declaredPlatform;
}

export async function hookCommand(platform: string, event: string, options: HookCommandOptions = {}): Promise<number> {
  // Suppress stderr in hook context — Claude Code shows stderr as error UI (#1181)
  // Exit 1: stderr shown to user. Exit 2: stderr fed to Claude for processing.
  // All diagnostics go to log file via logger; stderr must stay clean.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    let adapter = getPlatformAdapter(platform);
    const handler = getEventHandler(event);

    const rawInput = await readJsonFromStdin();

    // Auto-detect platform from stdin when command-line says "claude-code"
    // but stdin contains Cursor-specific fields (shared settings.json scenario)
    const detectedPlatform = autoDetectPlatform(platform, rawInput);
    if (detectedPlatform !== platform) {
      logger.info('HOOK', `Platform auto-detected: ${platform} → ${detectedPlatform}`);
      adapter = getPlatformAdapter(detectedPlatform);
    }

    const input = adapter.normalizeInput(rawInput);
    input.platform = detectedPlatform;  // Inject detected platform for handler-level decisions
    const result = await handler.execute(input);
    const output = adapter.formatOutput(result);

    console.log(JSON.stringify(output));
    const exitCode = result.exitCode ?? HOOK_EXIT_CODES.SUCCESS;
    if (!options.skipExit) {
      process.exit(exitCode);
    }
    return exitCode;
  } catch (error) {
    if (isWorkerUnavailableError(error)) {
      // Worker unavailable — degrade gracefully, don't block the user
      // Log to file instead of stderr (#1181)
      logger.warn('HOOK', `Worker unavailable, skipping hook: ${error instanceof Error ? error.message : error}`);
      if (!options.skipExit) {
        process.exit(HOOK_EXIT_CODES.SUCCESS);  // = 0 (graceful)
      }
      return HOOK_EXIT_CODES.SUCCESS;
    }

    // Handler/client bug — log to file instead of stderr (#1181)
    logger.error('HOOK', `Hook error: ${error instanceof Error ? error.message : error}`, {}, error instanceof Error ? error : undefined);
    if (!options.skipExit) {
      process.exit(HOOK_EXIT_CODES.BLOCKING_ERROR);  // = 2
    }
    return HOOK_EXIT_CODES.BLOCKING_ERROR;
  } finally {
    // Restore stderr for non-hook code paths (e.g., when skipExit is true and process continues as worker)
    process.stderr.write = originalStderrWrite;
  }
}
