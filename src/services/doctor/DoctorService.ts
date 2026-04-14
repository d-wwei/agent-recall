/**
 * DoctorService — Health audit engine
 *
 * Runs the 16 expectations defined in monitor/EXPECTATIONS.md against
 * the live database and log files.  Produces scored reports stored in
 * the doctor_reports table.
 *
 * Design:
 * - Takes a bun:sqlite Database instance (no own connection)
 * - Pure queries — no writes except to doctor_reports on runFull()
 * - E-1001 (log error rate) reads today's log file directly
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../../utils/logger.js';
import {
  EXPECTATIONS,
  SEVERITY_WEIGHTS,
  CRITICAL_IDS,
  gradeFromScore,
} from './expectations.js';
import type {
  DoctorReport,
  DoctorHistoryEntry,
  ExpectationResult,
  Score,
  Grade,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeCount(db: Database, sql: string, params: unknown[] = []): number {
  try {
    const row = db.prepare(sql).get(...params) as { cnt: number } | null;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// DoctorService
// ---------------------------------------------------------------------------

export class DoctorService {
  private logsDir: string;

  constructor(private db: Database) {
    this.logsDir = join(homedir(), '.agent-recall', 'logs');
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Run all 16 expectations, compute score, store report in DB.
   */
  runFull(): DoctorReport {
    const results = this.runAllExpectations();
    const { score, grade } = this.computeScore(results);
    const critical_failures = this.findCriticalFailures(results);
    const recommendations = this.generateRecommendations(results);
    const created_at = new Date().toISOString();

    const report: DoctorReport = {
      score: Math.round(score * 10) / 10,
      grade,
      mode: 'full',
      results,
      critical_failures,
      recommendations,
      created_at,
    };

    // Persist to doctor_reports
    try {
      this.db.prepare(`
        INSERT INTO doctor_reports (score, grade, mode, results, critical_failures, recommendations, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        report.score,
        report.grade,
        report.mode,
        JSON.stringify(report.results),
        JSON.stringify(report.critical_failures),
        JSON.stringify(report.recommendations),
        report.created_at,
      );
    } catch (err) {
      logger.error('DOCTOR', 'Failed to store report', {}, err as Error);
    }

    return report;
  }

  /**
   * Quick check — only CRITICAL expectations, no DB write.
   * Only runs 3 checks (E-201, E-401, E-402) for minimal latency on SessionStart.
   */
  runQuick(): DoctorReport {
    const results: Record<string, ExpectationResult> = {};
    for (const id of CRITICAL_IDS) {
      try {
        results[id] = this.runExpectation(id);
      } catch (err) {
        const exp = EXPECTATIONS.find(e => e.id === id)!;
        results[id] = { id, score: 'FAIL', result: `Error: ${(err as Error).message}`, value: null, severity: exp.severity };
      }
    }

    const { score, grade } = this.computeScore(results);
    const critical_failures = this.findCriticalFailures(results);

    return {
      score: Math.round(score * 10) / 10,
      grade,
      mode: 'quick',
      results,
      critical_failures,
      recommendations: [],
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Return historical reports, most recent first.
   */
  getHistory(days: number = 30): DoctorHistoryEntry[] {
    try {
      const rows = this.db.prepare(`
        SELECT id, score, grade, mode, critical_failures, created_at
        FROM doctor_reports
        WHERE created_at >= datetime('now', ?)
        ORDER BY created_at DESC
      `).all(`-${days} days`) as Array<{
        id: number;
        score: number;
        grade: string;
        mode: string;
        critical_failures: string | null;
        created_at: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        score: r.score,
        grade: r.grade as Grade,
        mode: r.mode,
        critical_failures: r.critical_failures ? JSON.parse(r.critical_failures) : [],
        created_at: r.created_at,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Return the most recent full report, or null.
   */
  getLatest(): DoctorReport | null {
    try {
      const row = this.db.prepare(`
        SELECT score, grade, mode, results, critical_failures, recommendations, created_at
        FROM doctor_reports
        WHERE mode = 'full'
        ORDER BY created_at DESC
        LIMIT 1
      `).get() as {
        score: number;
        grade: string;
        mode: string;
        results: string;
        critical_failures: string | null;
        recommendations: string | null;
        created_at: string;
      } | null;

      if (!row) return null;

      return {
        score: row.score,
        grade: row.grade as Grade,
        mode: 'full',
        results: JSON.parse(row.results),
        critical_failures: row.critical_failures ? JSON.parse(row.critical_failures) : [],
        recommendations: row.recommendations ? JSON.parse(row.recommendations) : [],
        created_at: row.created_at,
      };
    } catch {
      return null;
    }
  }

  // ---- Expectation runners -----------------------------------------------

  private runAllExpectations(): Record<string, ExpectationResult> {
    const results: Record<string, ExpectationResult> = {};

    for (const exp of EXPECTATIONS) {
      try {
        results[exp.id] = this.runExpectation(exp.id);
      } catch (err) {
        logger.warn('DOCTOR', `Expectation ${exp.id} failed`, { error: (err as Error).message });
        results[exp.id] = {
          id: exp.id,
          score: 'FAIL',
          result: `Error: ${(err as Error).message}`,
          value: null,
          severity: exp.severity,
        };
      }
    }

    return results;
  }

  private runExpectation(id: string): ExpectationResult {
    const exp = EXPECTATIONS.find((e) => e.id === id)!;
    const severity = exp.severity;

    switch (id) {
      case 'E-101': return this.checkWorkerHealth(severity);
      case 'E-201': return this.checkObservationRate(severity);
      case 'E-202': return this.checkObservationTypes(severity);
      case 'E-203': return this.checkObservationQuality(severity);
      case 'E-204': return this.checkDeduplication(severity);
      case 'E-301': return this.checkSummaryCoverage(severity);
      case 'E-302': return this.checkSummaryStructure(severity);
      case 'E-401': return this.checkCompilationRuns(severity);
      case 'E-402': return this.checkCompiledKnowledge(severity);
      case 'E-601': return this.checkEntityExtraction(severity);
      case 'E-602': return this.checkFactLinking(severity);
      case 'E-701': return this.checkDiaryEntries(severity);
      case 'E-801': return this.checkVectorSync(severity);
      case 'E-802': return this.checkFtsIndex(severity);
      case 'E-901': return this.checkPromptCapture(severity);
      case 'E-1001': return this.checkErrorRate(severity);
      default:
        return { id, score: 'INFO', result: 'Unknown expectation', value: null, severity };
    }
  }

  // ---- Individual checks -------------------------------------------------

  private checkWorkerHealth(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    // In-process check: if we're running inside the worker, we're UP.
    // If called externally, try a sync HTTP check.
    try {
      // Use a synchronous approach: check if the worker port file or PID exists
      const pidFile = join(homedir(), '.agent-recall', 'worker.pid');
      const isUp = existsSync(pidFile);
      return {
        id: 'E-101',
        score: isUp ? 'PASS' : 'INFO',
        result: isUp ? 'Worker is UP' : 'Worker PID file not found',
        value: isUp ? 1 : 0,
        severity,
      };
    } catch {
      return { id: 'E-101', score: 'INFO', result: 'Could not check worker', value: null, severity };
    }
  }

  private checkObservationRate(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const totalObs = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    const totalSessions = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM sdk_sessions');

    if (totalSessions === 0) {
      return { id: 'E-201', score: 'FAIL', result: '0 sessions', value: 0, severity };
    }

    const rate = totalObs / totalSessions;
    const rounded = Math.round(rate * 10) / 10;
    let score: Score = 'FAIL';
    if (rate >= 3) score = 'PASS';
    else if (rate >= 1) score = 'WARN';

    return {
      id: 'E-201',
      score,
      result: `${rounded} obs/session (${totalObs}/${totalSessions})`,
      value: rounded,
      severity,
    };
  }

  private checkObservationTypes(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const typeCount = safeCount(this.db, 'SELECT COUNT(DISTINCT type) as cnt FROM observations');

    let score: Score = 'FAIL';
    if (typeCount >= 4) score = 'PASS';
    else if (typeCount >= 2) score = 'WARN';

    return {
      id: 'E-202',
      score,
      result: `${typeCount} distinct types`,
      value: typeCount,
      severity,
    };
  }

  private checkObservationQuality(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    if (total === 0) {
      return { id: 'E-203', score: 'FAIL', result: '0 observations', value: 0, severity };
    }

    const withTitle = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations WHERE title IS NOT NULL AND title != \'\'');
    const pct = (withTitle / total) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 80) score = 'PASS';
    else if (pct >= 50) score = 'WARN';

    return {
      id: 'E-203',
      score,
      result: `${rounded}% have title (${withTitle}/${total})`,
      value: rounded,
      severity,
    };
  }

  private checkDeduplication(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    if (total === 0) {
      return { id: 'E-204', score: 'PASS', result: 'No observations', value: 100, severity };
    }

    const unique = safeCount(this.db, 'SELECT COUNT(DISTINCT content_hash) as cnt FROM observations WHERE content_hash IS NOT NULL');
    const pct = (unique / total) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 95) score = 'PASS';
    else if (pct >= 80) score = 'WARN';

    return {
      id: 'E-204',
      score,
      result: `${rounded}% unique (${unique}/${total})`,
      value: rounded,
      severity,
    };
  }

  private checkSummaryCoverage(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const totalSessions = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM sdk_sessions');
    const totalSummaries = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM session_summaries');

    if (totalSessions === 0) {
      return { id: 'E-301', score: 'FAIL', result: '0 sessions', value: 0, severity };
    }

    const pct = (totalSummaries / totalSessions) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 50) score = 'PASS';
    else if (pct >= 30) score = 'WARN';

    return {
      id: 'E-301',
      score,
      result: `${rounded}% coverage (${totalSummaries}/${totalSessions})`,
      value: rounded,
      severity,
    };
  }

  private checkSummaryStructure(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM session_summaries');
    if (total === 0) {
      return { id: 'E-302', score: 'FAIL', result: '0 summaries', value: 0, severity };
    }

    const structured = safeCount(this.db, `
      SELECT COUNT(*) as cnt FROM session_summaries
      WHERE request IS NOT NULL AND request != ''
        AND learned IS NOT NULL AND learned != ''
        AND completed IS NOT NULL AND completed != ''
        AND next_steps IS NOT NULL AND next_steps != ''
    `);
    const pct = (structured / total) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 70) score = 'PASS';
    else if (pct >= 40) score = 'WARN';

    return {
      id: 'E-302',
      score,
      result: `${rounded}% fully structured (${structured}/${total})`,
      value: rounded,
      severity,
    };
  }

  private checkCompilationRuns(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM compilation_logs');

    return {
      id: 'E-401',
      score: count > 0 ? 'PASS' : 'FAIL',
      result: `${count} compilation runs (expected: >0)`,
      value: count,
      severity,
    };
  }

  private checkCompiledKnowledge(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM compiled_knowledge');

    return {
      id: 'E-402',
      score: count > 0 ? 'PASS' : 'FAIL',
      result: `${count} knowledge pages (expected: >0)`,
      value: count,
      severity,
    };
  }

  private checkEntityExtraction(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM entities');
    const totalObs = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');

    return {
      id: 'E-601',
      score: count > 10 ? 'PASS' : 'FAIL',
      result: `${count} entities from ${totalObs} observations`,
      value: count,
      severity,
    };
  }

  private checkFactLinking(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM facts');

    return {
      id: 'E-602',
      score: count > 0 ? 'PASS' : 'FAIL',
      result: `${count} facts`,
      value: count,
      severity,
    };
  }

  private checkDiaryEntries(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM agent_diary');

    return {
      id: 'E-701',
      score: count > 3 ? 'PASS' : 'FAIL',
      result: `${count} diary entries`,
      value: count,
      severity,
    };
  }

  private checkVectorSync(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM sync_state');

    return {
      id: 'E-801',
      score: count > 0 ? 'PASS' : 'FAIL',
      result: `${count} sync records`,
      value: count,
      severity,
    };
  }

  private checkFtsIndex(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    // FTS tables can fail with "no such table" if not yet created
    const obsCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations_fts');
    const sumCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM session_summaries_fts');

    return {
      id: 'E-802',
      score: obsCount > 0 ? 'PASS' : 'FAIL',
      result: `FTS obs:${obsCount} summary:${sumCount}`,
      value: obsCount,
      severity,
    };
  }

  private checkPromptCapture(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const count = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM user_prompts');

    return {
      id: 'E-901',
      score: count > 0 ? 'PASS' : 'FAIL',
      result: `${count} prompts captured`,
      value: count,
      severity,
    };
  }

  private checkErrorRate(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    try {
      // Read today's log file
      const today = new Date().toISOString().split('T')[0];
      const logFile = join(this.logsDir, `claude-mem-${today}.log`);

      if (!existsSync(logFile)) {
        // Try to find the most recent log
        if (!existsSync(this.logsDir)) {
          return { id: 'E-1001', score: 'INFO', result: 'No log directory', value: null, severity };
        }
        const files = readdirSync(this.logsDir)
          .filter((f) => f.startsWith('claude-mem-') && f.endsWith('.log'))
          .sort()
          .reverse();

        if (files.length === 0) {
          return { id: 'E-1001', score: 'INFO', result: 'No log files found', value: null, severity };
        }

        // Use most recent log
        const content = readFileSync(join(this.logsDir, files[0]), 'utf-8');
        return this.analyzeLogContent(content, severity);
      }

      const content = readFileSync(logFile, 'utf-8');
      return this.analyzeLogContent(content, severity);
    } catch {
      return { id: 'E-1001', score: 'INFO', result: 'Could not read logs', value: null, severity };
    }
  }

  private analyzeLogContent(content: string, severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const totalLines = lines.length;

    if (totalLines === 0) {
      return { id: 'E-1001', score: 'PASS', result: '0 log lines', value: 0, severity };
    }

    const errorLines = lines.filter((l) => /\[ERROR\s*\]/.test(l)).length;
    const pct = (errorLines / totalLines) * 100;
    const rounded = Math.round(pct * 100) / 100;

    let score: Score = 'FAIL';
    if (pct <= 2) score = 'PASS';
    else if (pct <= 5) score = 'WARN';

    return {
      id: 'E-1001',
      score,
      result: `${rounded}% error rate (${errorLines}/${totalLines})`,
      value: rounded,
      severity,
    };
  }

  // ---- Scoring -----------------------------------------------------------

  private computeScore(results: Record<string, ExpectationResult>): { score: number; grade: Grade } {
    let totalWeight = 0;
    let earnedWeight = 0;

    for (const r of Object.values(results)) {
      const weight = SEVERITY_WEIGHTS[r.severity] ?? 1;
      totalWeight += weight;

      if (r.score === 'PASS') {
        earnedWeight += weight;
      } else if (r.score === 'WARN') {
        earnedWeight += weight * 0.5;
      } else if (r.score === 'INFO') {
        // INFO items don't count against — remove from total
        totalWeight -= weight;
      }
      // FAIL = 0
    }

    const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;
    return { score, grade: gradeFromScore(score) };
  }

  private findCriticalFailures(results: Record<string, ExpectationResult>): string[] {
    return Object.values(results)
      .filter((r) => r.severity === 'CRITICAL' && r.score === 'FAIL')
      .map((r) => r.id);
  }

  private generateRecommendations(results: Record<string, ExpectationResult>): string[] {
    const recs: string[] = [];

    for (const r of Object.values(results)) {
      if (r.score === 'PASS' || r.score === 'INFO') continue;

      switch (r.id) {
        case 'E-201':
          recs.push(`[CRITICAL] Observation capture rate too low (${r.id}) - Many sessions produce zero observations. PostToolUse hook may not be firing, or AI extraction may be failing silently.`);
          break;
        case 'E-202':
          recs.push(`[MEDIUM] Low observation type diversity (${r.id}) - Check that different tool types produce different observation types.`);
          break;
        case 'E-203':
          recs.push(`[HIGH] Observation quality below threshold (${r.id}) - Observations missing titles. Check AI extraction prompt.`);
          break;
        case 'E-204':
          recs.push(`[MEDIUM] Deduplication rate below threshold (${r.id}) - Content hash collision rate is high. Check dedup window.`);
          break;
        case 'E-301':
          recs.push(`[HIGH] Summary coverage too low (${r.id}) - Many sessions lack summaries. Check Stop hook.`);
          break;
        case 'E-302':
          recs.push(`[HIGH] Summaries not fully structured (${r.id}) - Missing request/learned/completed/next_steps fields.`);
          break;
        case 'E-401':
          recs.push(`[CRITICAL] No compilation runs detected (${r.id}) - Knowledge compilation never ran. Check compilation trigger.`);
          break;
        case 'E-402':
          recs.push(`[CRITICAL] No compiled knowledge pages (${r.id}) - Compilation may be failing silently.`);
          break;
        case 'E-601':
          recs.push(`[HIGH] Low entity extraction (${r.id}) - Entity extractor may not be running.`);
          break;
        case 'E-602':
          recs.push(`[HIGH] No facts linked (${r.id}) - Fact extraction pipeline may be broken.`);
          break;
        case 'E-701':
          recs.push(`[LOW] Few diary entries (${r.id}) - Agent diary not growing. Check diary service.`);
          break;
        case 'E-801':
          recs.push(`[HIGH] No vector sync records (${r.id}) - SeekDB sync may not be running.`);
          break;
        case 'E-802':
          recs.push(`[HIGH] FTS index empty (${r.id}) - Full-text search will not work.`);
          break;
        case 'E-901':
          recs.push(`[MEDIUM] No user prompts captured (${r.id}) - UserPromptSubmit hook may not be firing.`);
          break;
        case 'E-1001':
          recs.push(`[HIGH] Error rate too high (${r.id}) - Check log for repeating error patterns.`);
          break;
      }
    }

    return recs;
  }
}
