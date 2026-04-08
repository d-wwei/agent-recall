/**
 * AuditService tests
 *
 * Tests audit logging, log retrieval, filtering, pagination,
 * review date tracking, and review-due logic with in-memory SQLite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { AuditService } from '../../src/services/audit/AuditService.js';
import type { Database } from 'bun:sqlite';

const DAY_MS = 86_400_000;

describe('AuditService', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('log()', () => {
    it('should create an audit entry', () => {
      AuditService.log(db, {
        action: 'cleanup',
        details: { retention_days: 90 },
        record_count: 42,
      });

      const rows = db.prepare('SELECT * FROM audit_log').all() as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('cleanup');
      expect(rows[0].record_count).toBe(42);
      expect(JSON.parse(rows[0].details)).toEqual({ retention_days: 90 });
      expect(rows[0].performed_at).toBeTruthy();
      expect(rows[0].performed_at_epoch).toBeGreaterThan(0);
    });

    it('should handle missing optional fields', () => {
      AuditService.log(db, { action: 'profile_update' });

      const rows = db.prepare('SELECT * FROM audit_log').all() as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].action).toBe('profile_update');
      expect(rows[0].details).toBeNull();
      expect(rows[0].record_count).toBeNull();
    });

    it('should not throw on error (table missing scenario simulated)', () => {
      // Close db and use a fresh connection without migrations to simulate missing table
      db.close();
      const { Database } = require('bun:sqlite');
      const rawDb = new Database(':memory:');

      // Should not throw
      expect(() => {
        AuditService.log(rawDb, { action: 'cleanup' });
      }).not.toThrow();

      rawDb.close();
    });
  });

  describe('getLog()', () => {
    it('should return entries in reverse chronological order', () => {
      // Insert entries with slight time gaps
      AuditService.log(db, { action: 'cleanup', details: { order: 'first' } });
      // Small delay to ensure different epochs
      const now = Date.now();
      db.prepare(`
        INSERT INTO audit_log (action, details, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?)
      `).run('profile_update', '{"order":"second"}', new Date(now + 1000).toISOString(), now + 1000);

      const entries = AuditService.getLog(db);
      expect(entries.length).toBe(2);
      // Newest first
      expect(entries[0].action).toBe('profile_update');
      expect(entries[1].action).toBe('cleanup');
    });

    it('should filter by action', () => {
      AuditService.log(db, { action: 'cleanup' });
      AuditService.log(db, { action: 'profile_update' });
      AuditService.log(db, { action: 'cleanup' });

      const cleanupOnly = AuditService.getLog(db, { action: 'cleanup' });
      expect(cleanupOnly.length).toBe(2);
      expect(cleanupOnly.every(e => e.action === 'cleanup')).toBe(true);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        AuditService.log(db, { action: 'cleanup', record_count: i });
      }

      const limited = AuditService.getLog(db, { limit: 3 });
      expect(limited.length).toBe(3);
    });

    it('should respect offset', () => {
      for (let i = 0; i < 5; i++) {
        const epoch = Date.now() + i * 1000;
        db.prepare(`
          INSERT INTO audit_log (action, record_count, performed_at, performed_at_epoch)
          VALUES (?, ?, ?, ?)
        `).run('cleanup', i, new Date(epoch).toISOString(), epoch);
      }

      const page2 = AuditService.getLog(db, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);
      // After skipping 2 newest entries (4,3), should get 2,1
      expect(page2[0].record_count).toBe(2);
      expect(page2[1].record_count).toBe(1);
    });

    it('should default limit to 50', () => {
      for (let i = 0; i < 60; i++) {
        AuditService.log(db, { action: 'cleanup', record_count: i });
      }

      const entries = AuditService.getLog(db);
      expect(entries.length).toBe(50);
    });
  });

  describe('getLastReviewDate()', () => {
    it('should return null when no reviews exist', () => {
      const result = AuditService.getLastReviewDate(db);
      expect(result).toBeNull();
    });

    it('should return null when only non-review entries exist', () => {
      AuditService.log(db, { action: 'cleanup' });
      AuditService.log(db, { action: 'profile_update' });

      const result = AuditService.getLastReviewDate(db);
      expect(result).toBeNull();
    });
  });

  describe('setReviewDate() and getLastReviewDate()', () => {
    it('should round-trip review date', () => {
      const reviewDate = '2026-04-07T12:00:00.000Z';
      AuditService.setReviewDate(db, reviewDate);

      const lastReview = AuditService.getLastReviewDate(db);
      // lastReview is the performed_at of the audit entry, not the detail date
      expect(lastReview).not.toBeNull();
      expect(typeof lastReview).toBe('string');
    });

    it('should return the most recent review date', () => {
      // Insert two reviews with different times
      const now = Date.now();
      db.prepare(`
        INSERT INTO audit_log (action, details, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?)
      `).run('memory_review', '{}', new Date(now - 10000).toISOString(), now - 10000);

      db.prepare(`
        INSERT INTO audit_log (action, details, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?)
      `).run('memory_review', '{}', new Date(now).toISOString(), now);

      const lastReview = AuditService.getLastReviewDate(db);
      // Should return the newest one
      expect(lastReview).toBe(new Date(now).toISOString());
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', () => {
      AuditService.log(db, { action: 'cleanup', record_count: 10 });
      AuditService.log(db, { action: 'cleanup', record_count: 5 });
      AuditService.log(db, { action: 'profile_update' });
      AuditService.setReviewDate(db, '2026-04-07');

      const stats = AuditService.getStats(db);
      expect(stats.total_entries).toBe(4); // 2 cleanup + 1 profile_update + 1 memory_review
      expect(stats.last_review_date).not.toBeNull();
      expect(stats.entries_by_action['cleanup']).toBe(2);
      expect(stats.entries_by_action['profile_update']).toBe(1);
      expect(stats.entries_by_action['memory_review']).toBe(1);
    });

    it('should return empty stats for empty database', () => {
      const stats = AuditService.getStats(db);
      expect(stats.total_entries).toBe(0);
      expect(stats.last_review_date).toBeNull();
      expect(Object.keys(stats.entries_by_action).length).toBe(0);
    });
  });

  describe('review-due logic', () => {
    it('should consider review due when no reviews exist', () => {
      const lastReview = AuditService.getLastReviewDate(db);
      // No review date => due
      expect(lastReview).toBeNull();
    });

    it('should consider review due when last review > 30 days ago', () => {
      const now = Date.now();
      const thirtyOneDaysAgo = now - (31 * DAY_MS);

      db.prepare(`
        INSERT INTO audit_log (action, details, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?)
      `).run('memory_review', '{}', new Date(thirtyOneDaysAgo).toISOString(), thirtyOneDaysAgo);

      const lastReview = AuditService.getLastReviewDate(db);
      expect(lastReview).not.toBeNull();

      const lastReviewEpoch = new Date(lastReview!).getTime();
      const daysSince = Math.floor((now - lastReviewEpoch) / DAY_MS);
      expect(daysSince).toBeGreaterThan(30);
    });

    it('should consider review NOT due when last review < 30 days ago', () => {
      const now = Date.now();
      const tenDaysAgo = now - (10 * DAY_MS);

      db.prepare(`
        INSERT INTO audit_log (action, details, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?)
      `).run('memory_review', '{}', new Date(tenDaysAgo).toISOString(), tenDaysAgo);

      const lastReview = AuditService.getLastReviewDate(db);
      expect(lastReview).not.toBeNull();

      const lastReviewEpoch = new Date(lastReview!).getTime();
      const daysSince = Math.floor((now - lastReviewEpoch) / DAY_MS);
      expect(daysSince).toBeLessThanOrEqual(30);
    });
  });
});
