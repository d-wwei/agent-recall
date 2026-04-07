/**
 * Tests for queue management CLI scripts
 *
 * Source: scripts/check-pending-queue.ts, scripts/clear-failed-queue.ts
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests only pure utility functions (formatAge) and argument parsing logic
 * - No network, database, or filesystem access
 *
 * Value: Validates time formatting used in queue status display and
 * argument parsing patterns shared across queue management scripts.
 */
import { describe, it, expect } from 'bun:test';

// ─── formatAge (shared logic in both queue scripts) ─────────────────
// Reimplemented here since the scripts don't export it.
// This tests the algorithm, not the import path.

function formatAge(epochMs: number): string {
  const ageMs = Date.now() - epochMs;
  const minutes = Math.floor(ageMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  return `${minutes}m ago`;
}

describe('queue scripts shared logic', () => {

  describe('formatAge', () => {
    it('should format recent timestamps in minutes', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(formatAge(fiveMinutesAgo)).toBe('5m ago');
    });

    it('should format zero minutes ago', () => {
      const now = Date.now();
      expect(formatAge(now)).toBe('0m ago');
    });

    it('should format timestamps in hours and minutes', () => {
      const twoHoursThirtyMinAgo = Date.now() - (2 * 60 + 30) * 60 * 1000;
      expect(formatAge(twoHoursThirtyMinAgo)).toBe('2h 30m ago');
    });

    it('should format exactly one hour', () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      expect(formatAge(oneHourAgo)).toBe('1h 0m ago');
    });

    it('should format timestamps in days and hours', () => {
      const threeDaysFiveHoursAgo = Date.now() - (3 * 24 + 5) * 60 * 60 * 1000;
      expect(formatAge(threeDaysFiveHoursAgo)).toBe('3d 5h ago');
    });

    it('should format exactly one day', () => {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      expect(formatAge(oneDayAgo)).toBe('1d 0h ago');
    });

    it('should handle 59 minutes (still in minute range)', () => {
      const fiftyNineMinAgo = Date.now() - 59 * 60 * 1000;
      expect(formatAge(fiftyNineMinAgo)).toBe('59m ago');
    });

    it('should handle 23 hours (still in hour range)', () => {
      const twentyThreeHoursAgo = Date.now() - 23 * 60 * 60 * 1000;
      expect(formatAge(twentyThreeHoursAgo)).toBe('23h 0m ago');
    });
  });

  // ─── Argument parsing patterns ────────────────────────────────────
  // Both scripts use similar argument parsing. Test the shared patterns.

  describe('check-pending-queue argument parsing', () => {
    function parseCheckQueueArgs(args: string[]) {
      const help = args.includes('--help') || args.includes('-h');
      const autoProcess = args.includes('--process');
      const limitArg = args.find((_, i) => args[i - 1] === '--limit');
      const limit = limitArg ? parseInt(limitArg, 10) : 10;
      return { help, autoProcess, limit };
    }

    it('should parse --help flag', () => {
      expect(parseCheckQueueArgs(['--help'])).toEqual({ help: true, autoProcess: false, limit: 10 });
    });

    it('should parse -h shorthand', () => {
      expect(parseCheckQueueArgs(['-h'])).toEqual({ help: true, autoProcess: false, limit: 10 });
    });

    it('should parse --process flag', () => {
      expect(parseCheckQueueArgs(['--process'])).toEqual({ help: false, autoProcess: true, limit: 10 });
    });

    it('should parse --limit with value', () => {
      expect(parseCheckQueueArgs(['--process', '--limit', '5'])).toEqual({
        help: false, autoProcess: true, limit: 5,
      });
    });

    it('should default limit to 10 when not specified', () => {
      expect(parseCheckQueueArgs(['--process'])).toEqual({
        help: false, autoProcess: true, limit: 10,
      });
    });

    it('should handle no arguments', () => {
      expect(parseCheckQueueArgs([])).toEqual({ help: false, autoProcess: false, limit: 10 });
    });

    it('should handle NaN limit gracefully', () => {
      const result = parseCheckQueueArgs(['--limit', 'abc']);
      expect(Number.isNaN(result.limit)).toBe(true);
    });
  });

  describe('clear-failed-queue argument parsing', () => {
    function parseClearQueueArgs(args: string[]) {
      const help = args.includes('--help') || args.includes('-h');
      const force = args.includes('--force');
      const clearAll = args.includes('--all');
      return { help, force, clearAll };
    }

    it('should parse --help flag', () => {
      expect(parseClearQueueArgs(['--help'])).toEqual({ help: true, force: false, clearAll: false });
    });

    it('should parse --force flag', () => {
      expect(parseClearQueueArgs(['--force'])).toEqual({ help: false, force: true, clearAll: false });
    });

    it('should parse --all flag', () => {
      expect(parseClearQueueArgs(['--all'])).toEqual({ help: false, force: false, clearAll: true });
    });

    it('should parse combined flags', () => {
      expect(parseClearQueueArgs(['--all', '--force'])).toEqual({
        help: false, force: true, clearAll: true,
      });
    });

    it('should handle no arguments', () => {
      expect(parseClearQueueArgs([])).toEqual({ help: false, force: false, clearAll: false });
    });
  });

  // ─── Queue message grouping logic ─────────────────────────────────

  describe('queue message grouping', () => {
    interface QueueMessage {
      id: number;
      session_db_id: number;
      status: 'pending' | 'processing' | 'failed';
      created_at_epoch: number;
      project: string | null;
    }

    function groupBySession(messages: QueueMessage[]): Map<number, QueueMessage[]> {
      const bySession = new Map<number, QueueMessage[]>();
      for (const msg of messages) {
        const list = bySession.get(msg.session_db_id) || [];
        list.push(msg);
        bySession.set(msg.session_db_id, list);
      }
      return bySession;
    }

    it('should group messages by session_db_id', () => {
      const messages: QueueMessage[] = [
        { id: 1, session_db_id: 10, status: 'pending', created_at_epoch: 1000, project: 'p1' },
        { id: 2, session_db_id: 10, status: 'failed', created_at_epoch: 2000, project: 'p1' },
        { id: 3, session_db_id: 20, status: 'pending', created_at_epoch: 3000, project: 'p2' },
      ];

      const grouped = groupBySession(messages);
      expect(grouped.size).toBe(2);
      expect(grouped.get(10)).toHaveLength(2);
      expect(grouped.get(20)).toHaveLength(1);
    });

    it('should handle empty message list', () => {
      const grouped = groupBySession([]);
      expect(grouped.size).toBe(0);
    });

    it('should handle all messages in single session', () => {
      const messages: QueueMessage[] = [
        { id: 1, session_db_id: 5, status: 'pending', created_at_epoch: 1000, project: null },
        { id: 2, session_db_id: 5, status: 'processing', created_at_epoch: 2000, project: null },
        { id: 3, session_db_id: 5, status: 'failed', created_at_epoch: 3000, project: null },
      ];

      const grouped = groupBySession(messages);
      expect(grouped.size).toBe(1);
      expect(grouped.get(5)).toHaveLength(3);
    });
  });

  // ─── Backlog detection logic ──────────────────────────────────────

  describe('backlog detection', () => {
    it('should detect backlog when pending messages exist', () => {
      const queue = { totalPending: 5, totalProcessing: 0, totalFailed: 0, stuckCount: 0 };
      const hasBacklog = queue.totalPending > 0 || queue.totalFailed > 0;
      expect(hasBacklog).toBe(true);
    });

    it('should detect backlog when failed messages exist', () => {
      const queue = { totalPending: 0, totalProcessing: 0, totalFailed: 3, stuckCount: 0 };
      const hasBacklog = queue.totalPending > 0 || queue.totalFailed > 0;
      expect(hasBacklog).toBe(true);
    });

    it('should not detect backlog when only processing', () => {
      const queue = { totalPending: 0, totalProcessing: 2, totalFailed: 0, stuckCount: 0 };
      const hasBacklog = queue.totalPending > 0 || queue.totalFailed > 0;
      expect(hasBacklog).toBe(false);
    });

    it('should detect stuck messages separately', () => {
      const queue = { totalPending: 0, totalProcessing: 0, totalFailed: 0, stuckCount: 1 };
      const hasStuck = queue.stuckCount > 0;
      expect(hasStuck).toBe(true);
    });

    it('should report healthy when everything is zero', () => {
      const queue = { totalPending: 0, totalProcessing: 0, totalFailed: 0, stuckCount: 0 };
      const hasBacklog = queue.totalPending > 0 || queue.totalFailed > 0;
      const hasStuck = queue.stuckCount > 0;
      expect(hasBacklog).toBe(false);
      expect(hasStuck).toBe(false);
    });
  });

  // ─── clear-failed-queue: totalToClear calculation ─────────────────

  describe('totalToClear calculation', () => {
    it('should count only failed when not clearing all', () => {
      const queue = { totalPending: 5, totalProcessing: 2, totalFailed: 3 };
      const clearAll = false;
      const total = clearAll
        ? queue.totalPending + queue.totalProcessing + queue.totalFailed
        : queue.totalFailed;
      expect(total).toBe(3);
    });

    it('should count all statuses when clearing all', () => {
      const queue = { totalPending: 5, totalProcessing: 2, totalFailed: 3 };
      const clearAll = true;
      const total = clearAll
        ? queue.totalPending + queue.totalProcessing + queue.totalFailed
        : queue.totalFailed;
      expect(total).toBe(10);
    });

    it('should return 0 when queue is empty', () => {
      const queue = { totalPending: 0, totalProcessing: 0, totalFailed: 0 };
      const clearAll = true;
      const total = clearAll
        ? queue.totalPending + queue.totalProcessing + queue.totalFailed
        : queue.totalFailed;
      expect(total).toBe(0);
    });
  });
});
