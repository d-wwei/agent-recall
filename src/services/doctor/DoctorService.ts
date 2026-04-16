/**
 * DoctorService — Health audit engine
 *
 * Runs the 21 expectations defined in monitor/EXPECTATIONS.md against
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
  DeepReport,
  DoctorHistoryEntry,
  ExpectationResult,
  Score,
  Grade,
  DailyBreakdown,
  SessionStatusBreakdown,
  ObsPerSessionEntry,
  ObservationQuality,
  SummaryQuality,
  LogAnalysis,
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
  private lastInsertId: number | null = null;

  constructor(private db: Database) {
    this.logsDir = join(homedir(), '.agent-recall', 'logs');
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Run all 21 expectations, compute score, store report in DB.
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
    this.lastInsertId = null;
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
      const row = this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number } | null;
      this.lastInsertId = row?.id ?? null;
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
        WHERE mode IN ('full', 'deep')
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
        mode: row.mode as 'full' | 'deep',
        results: JSON.parse(row.results),
        critical_failures: row.critical_failures ? JSON.parse(row.critical_failures) : [],
        recommendations: row.recommendations ? JSON.parse(row.recommendations) : [],
        created_at: row.created_at,
      };
    } catch {
      return null;
    }
  }

  // ---- Deep analysis -----------------------------------------------------

  /**
   * Run full audit + deep analysis. Stores complete report in DB.
   */
  runDeep(): DeepReport {
    const fullReport = this.runFull();

    const deep: DeepReport = {
      ...fullReport,
      mode: 'deep',
      daily_breakdown: this.deepDailyBreakdown(),
      session_status: this.deepSessionStatus(),
      obs_per_session: this.deepObsPerSession(),
      observation_quality: this.deepObservationQuality(),
      summary_quality: this.deepSummaryQuality(),
      log_analysis: this.deepLogAnalysis(),
    };

    // Enhance recommendations with deep-analysis-aware insights
    deep.recommendations = this.generateDeepRecommendations(deep);

    // Store deep_analysis in the most recent report row
    try {
      const deepJson = JSON.stringify({
        daily_breakdown: deep.daily_breakdown,
        session_status: deep.session_status,
        obs_per_session: deep.obs_per_session,
        observation_quality: deep.observation_quality,
        summary_quality: deep.summary_quality,
        log_analysis: deep.log_analysis,
      });
      if (this.lastInsertId) {
        this.db.prepare(`
          UPDATE doctor_reports SET deep_analysis = ?, mode = 'deep', recommendations = ?
          WHERE id = ?
        `).run(deepJson, JSON.stringify(deep.recommendations), this.lastInsertId);
      }
    } catch (err) {
      logger.warn('DOCTOR', 'Failed to store deep analysis', { error: (err as Error).message });
    }

    return deep;
  }

  private deepDailyBreakdown(): DailyBreakdown[] {
    const days: DailyBreakdown[] = [];
    const tables = [
      { key: 'observations', sql: "SELECT DATE(created_at) as day, COUNT(*) as cnt FROM observations WHERE created_at > datetime('now', '-7 days') GROUP BY day ORDER BY day" },
      { key: 'sessions', sql: "SELECT DATE(started_at) as day, COUNT(*) as cnt FROM sdk_sessions WHERE started_at > datetime('now', '-7 days') GROUP BY day ORDER BY day" },
      { key: 'summaries', sql: "SELECT DATE(created_at) as day, COUNT(*) as cnt FROM session_summaries WHERE created_at > datetime('now', '-7 days') GROUP BY day ORDER BY day" },
      { key: 'prompts', sql: "SELECT DATE(created_at) as day, COUNT(*) as cnt FROM user_prompts WHERE created_at > datetime('now', '-7 days') GROUP BY day ORDER BY day" },
    ];

    const dayMap = new Map<string, DailyBreakdown>();

    for (const { key, sql } of tables) {
      try {
        const rows = this.db.prepare(sql).all() as Array<{ day: string; cnt: number }>;
        for (const row of rows) {
          if (!row.day) continue;
          if (!dayMap.has(row.day)) {
            dayMap.set(row.day, { date: row.day, observations: 0, sessions: 0, summaries: 0, prompts: 0 });
          }
          (dayMap.get(row.day)! as unknown as Record<string, number | string>)[key] = row.cnt;
        }
      } catch { /* table may not exist */ }
    }

    return Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private deepSessionStatus(): SessionStatusBreakdown {
    const result: SessionStatusBreakdown = { completed: 0, interrupted: 0, failed: 0, active: 0 };
    try {
      const rows = this.db.prepare('SELECT status, COUNT(*) as cnt FROM sdk_sessions GROUP BY status').all() as Array<{ status: string; cnt: number }>;
      for (const row of rows) {
        if (row.status in result) {
          (result as unknown as Record<string, number>)[row.status] = row.cnt;
        }
      }
    } catch { /* */ }
    return result;
  }

  private deepObsPerSession(): ObsPerSessionEntry[] {
    try {
      const rows = this.db.prepare(`
        SELECT obs_count, COUNT(*) as session_count FROM (
          SELECT s.id, COALESCE(o.cnt, 0) as obs_count
          FROM sdk_sessions s
          LEFT JOIN (
            SELECT memory_session_id, COUNT(*) as cnt
            FROM observations GROUP BY memory_session_id
          ) o ON o.memory_session_id = s.memory_session_id
        ) GROUP BY obs_count ORDER BY obs_count
      `).all() as Array<{ obs_count: number; session_count: number }>;
      return rows;
    } catch {
      return [];
    }
  }

  private deepObservationQuality(): ObservationQuality {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    const has_title = safeCount(this.db, "SELECT COUNT(*) as cnt FROM observations WHERE title IS NOT NULL AND title != ''");
    const has_narrative = safeCount(this.db, "SELECT COUNT(*) as cnt FROM observations WHERE narrative IS NOT NULL AND narrative != ''");
    const has_facts = safeCount(this.db, "SELECT COUNT(*) as cnt FROM observations WHERE facts IS NOT NULL AND facts != '' AND facts != '[]'");
    const has_concepts = safeCount(this.db, "SELECT COUNT(*) as cnt FROM observations WHERE concepts IS NOT NULL AND concepts != '' AND concepts != '[]'");
    const unique_hashes = safeCount(this.db, 'SELECT COUNT(DISTINCT content_hash) as cnt FROM observations WHERE content_hash IS NOT NULL');

    let type_distribution: Array<{ type: string; count: number }> = [];
    try {
      type_distribution = this.db.prepare('SELECT type, COUNT(*) as count FROM observations GROUP BY type ORDER BY count DESC').all() as Array<{ type: string; count: number }>;
    } catch { /* */ }

    return { total, has_title, has_narrative, has_facts, has_concepts, unique_hashes, type_distribution };
  }

  private deepSummaryQuality(): SummaryQuality {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM session_summaries');
    const has_request = safeCount(this.db, "SELECT COUNT(*) as cnt FROM session_summaries WHERE request IS NOT NULL AND request != ''");
    const has_next_steps = safeCount(this.db, "SELECT COUNT(*) as cnt FROM session_summaries WHERE next_steps IS NOT NULL AND next_steps != ''");
    const has_learned = safeCount(this.db, "SELECT COUNT(*) as cnt FROM session_summaries WHERE learned IS NOT NULL AND learned != ''");
    const has_completed = safeCount(this.db, "SELECT COUNT(*) as cnt FROM session_summaries WHERE completed IS NOT NULL AND completed != ''");
    const fully_structured = safeCount(this.db, `
      SELECT COUNT(*) as cnt FROM session_summaries
      WHERE request IS NOT NULL AND request != ''
        AND learned IS NOT NULL AND learned != ''
        AND completed IS NOT NULL AND completed != ''
        AND next_steps IS NOT NULL AND next_steps != ''
    `);

    return { total, has_request, has_next_steps, has_learned, has_completed, fully_structured };
  }

  private deepLogAnalysis(): LogAnalysis {
    const result: LogAnalysis = {
      total_lines: 0, errors: 0, warnings: 0,
      session_starts: 0, extraction_events: 0, context_events: 0, compilation_events: 0,
      top_error_patterns: [],
    };

    try {
      const today = new Date().toISOString().split('T')[0];
      let logFile = join(this.logsDir, `claude-mem-${today}.log`);

      if (!existsSync(logFile)) {
        if (!existsSync(this.logsDir)) return result;
        const files = readdirSync(this.logsDir)
          .filter((f) => f.startsWith('claude-mem-') && f.endsWith('.log'))
          .sort().reverse();
        if (files.length === 0) return result;
        logFile = join(this.logsDir, files[0]);
      }

      const content = readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      result.total_lines = lines.length;

      const errorPatterns = new Map<string, number>();

      for (const line of lines) {
        if (/\[ERROR\s*\]/.test(line)) {
          result.errors++;
          // Extract component from [ERROR] [COMPONENT]
          const match = line.match(/\[ERROR\s*\]\s*\[(\w+)\s*\]/);
          if (match) {
            const pattern = match[1];
            errorPatterns.set(pattern, (errorPatterns.get(pattern) || 0) + 1);
          }
        }
        if (/\[WARN\s*\]/.test(line)) result.warnings++;
        if (/session.*start|SessionStart/i.test(line)) result.session_starts++;
        if (/extract|MINER/i.test(line)) result.extraction_events++;
        if (/context.*inject|context.*build|CONTEXT/i.test(line)) result.context_events++;
        if (/compil|COMPILATION/i.test(line)) result.compilation_events++;
      }

      result.top_error_patterns = Array.from(errorPatterns.entries())
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    } catch { /* */ }

    return result;
  }

  private generateDeepRecommendations(deep: DeepReport): string[] {
    // Start with base recommendations from runFull
    const recs = [...deep.recommendations];

    // Session status analysis
    const total = deep.session_status.completed + deep.session_status.interrupted + deep.session_status.failed + deep.session_status.active;
    if (total > 0 && deep.session_status.interrupted / total > 0.3) {
      recs.push(`[HIGH] Too many interrupted sessions (${deep.session_status.interrupted}/${total} = ${Math.round(deep.session_status.interrupted / total * 100)}%). Terminal closures or crashes may be preventing proper session completion.`);
    }

    // Obs per session zero-capture analysis
    const zeroCaptureEntry = deep.obs_per_session.find((e) => e.obs_count === 0);
    if (zeroCaptureEntry && total > 0 && zeroCaptureEntry.session_count / total > 0.15) {
      recs.push(`[HIGH] ${zeroCaptureEntry.session_count} sessions (${Math.round(zeroCaptureEntry.session_count / total * 100)}%) produced zero observations. PostToolUse hook may not be firing for these sessions.`);
    }

    // Vector sync coverage
    const syncCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM sync_state');
    const obsCount = deep.observation_quality.total;
    if (obsCount > 0 && syncCount < obsCount * 0.5) {
      recs.push(`[HIGH] Vector sync severely behind (${syncCount} synced vs ${obsCount} observations). Semantic search quality degraded.`);
    }

    // Knowledge graph density
    const entityCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM entities');
    const factCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM facts');
    if (entityCount > 10 && factCount < entityCount * 0.5) {
      recs.push(`[MEDIUM] Knowledge graph has nodes but few edges (${entityCount} entities, ${factCount} facts). Fact extraction may need attention.`);
    }

    return recs;
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
      case 'E-103': return this.checkActiveSessionAccumulation(severity);
      case 'E-104': return this.checkSessionCompletedAt(severity);
      case 'E-201': return this.checkObservationRate(severity);
      case 'E-202': return this.checkObservationTypes(severity);
      case 'E-203': return this.checkObservationQuality(severity);
      case 'E-204': return this.checkDeduplication(severity);
      case 'E-205': return this.checkObservationFactsCoverage(severity);
      case 'E-301': return this.checkSummaryCoverage(severity);
      case 'E-302': return this.checkSummaryStructure(severity);
      case 'E-401': return this.checkCompilationRuns(severity);
      case 'E-402': return this.checkCompiledKnowledge(severity);
      case 'E-403': return this.checkKnowledgePageUpdates(severity);
      case 'E-601': return this.checkEntityExtraction(severity);
      case 'E-602': return this.checkFactDensity(severity);
      case 'E-701': return this.checkDiaryEntries(severity);
      case 'E-801': return this.checkVectorSync(severity);
      case 'E-802': return this.checkFtsIndex(severity);
      case 'E-901': return this.checkPromptCapture(severity);
      case 'E-1001': return this.checkErrorRate(severity);
      case 'E-1002': return this.checkTrendDegradation(severity);
      default:
        return { id, score: 'INFO', result: 'Unknown expectation', value: null, severity };
    }
  }

  // ---- Individual checks -------------------------------------------------

  private checkWorkerHealth(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    // DoctorService runs inside the worker process (via DoctorRoutes),
    // so if we're executing, the worker is definitionally UP.
    // For robustness, also try a sync HTTP probe via Bun.spawnSync.
    try {
      const proc = Bun.spawnSync(['curl', '-s', '--max-time', '2', 'http://localhost:37777/api/health'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = proc.stdout.toString().trim();
      const isUp = proc.exitCode === 0 && output.includes('"status":"ok"');
      return {
        id: 'E-101',
        score: isUp ? 'PASS' : 'INFO',
        result: isUp ? 'Worker is UP' : 'Worker health probe failed',
        value: isUp ? 1 : 0,
        severity,
      };
    } catch {
      // If curl isn't available or probe fails, we're inside the worker — so UP
      return { id: 'E-101', score: 'PASS', result: 'Worker is UP (in-process)', value: 1, severity };
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

    const totalPct = (totalSummaries / totalSessions) * 100;
    const totalRounded = Math.round(totalPct * 10) / 10;

    // Total check fails → FAIL regardless of recency
    if (totalPct < 30) {
      return { id: 'E-301', score: 'FAIL', result: `${totalRounded}% total coverage (${totalSummaries}/${totalSessions})`, value: totalRounded, severity };
    }
    if (totalPct < 50) {
      return { id: 'E-301', score: 'WARN', result: `${totalRounded}% total coverage (${totalSummaries}/${totalSessions})`, value: totalRounded, severity };
    }

    // Total >= 50% → check recent 7-day incremental
    const row = this.db.prepare(`
      SELECT
        COUNT(DISTINCT s.id) as recent_completed,
        COUNT(DISTINCT sm.id) as recent_with_summary
      FROM sdk_sessions s
      LEFT JOIN session_summaries sm ON sm.memory_session_id = s.memory_session_id
      WHERE s.status = 'completed'
        AND s.started_at > datetime('now', '-7 days')
    `).get() as { recent_completed: number; recent_with_summary: number } | null;

    const recentCompleted = row?.recent_completed ?? 0;
    const recentWithSummary = row?.recent_with_summary ?? 0;

    // No recent completed sessions → fall back to total-only (no penalty)
    if (recentCompleted === 0) {
      return { id: 'E-301', score: 'PASS', result: `${totalRounded}% total (no recent completed sessions)`, value: totalRounded, severity };
    }

    const recentPct = (recentWithSummary / recentCompleted) * 100;
    const recentRounded = Math.round(recentPct * 10) / 10;

    let score: Score = 'WARN';
    if (recentPct >= 70) score = 'PASS';

    return {
      id: 'E-301',
      score,
      result: `${totalRounded}% total, ${recentRounded}% recent 7d (${recentWithSummary}/${recentCompleted})`,
      value: recentRounded,
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
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_runs,
        COUNT(CASE WHEN completed_at > datetime('now', '-7 days') THEN 1 END) as recent_runs
      FROM compilation_logs
    `).get() as { total_runs: number; recent_runs: number } | null;

    const total = row?.total_runs ?? 0;
    const recent = row?.recent_runs ?? 0;

    if (total === 0) {
      return { id: 'E-401', score: 'FAIL', result: '0 compilation runs', value: 0, severity };
    }

    // Has recent sessions? Check if there's activity to compile
    const recentSessions = safeCount(this.db, "SELECT COUNT(*) as cnt FROM sdk_sessions WHERE started_at > datetime('now', '-7 days')");

    // No recent sessions → no reason to expect recent compilation, total-only
    if (recentSessions === 0) {
      return { id: 'E-401', score: 'PASS', result: `${total} runs (no recent sessions)`, value: total, severity };
    }

    const score: Score = recent > 0 ? 'PASS' : 'WARN';
    return {
      id: 'E-401',
      score,
      result: `${total} total, ${recent} in last 7d`,
      value: total,
      severity,
    };
  }

  private checkCompiledKnowledge(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_pages,
        COUNT(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 END) as recent_new,
        COUNT(CASE WHEN version > 1 THEN 1 END) as updated_pages
      FROM compiled_knowledge
    `).get() as { total_pages: number; recent_new: number; updated_pages: number } | null;

    const total = row?.total_pages ?? 0;
    const recentNew = row?.recent_new ?? 0;
    const updated = row?.updated_pages ?? 0;

    if (total === 0) {
      return { id: 'E-402', score: 'FAIL', result: '0 knowledge pages', value: 0, severity };
    }

    // No recent sessions → no reason to expect growth, total-only
    const recentSessions = safeCount(this.db, "SELECT COUNT(*) as cnt FROM sdk_sessions WHERE started_at > datetime('now', '-7 days')");
    if (recentSessions === 0) {
      return { id: 'E-402', score: 'PASS', result: `${total} pages (no recent sessions)`, value: total, severity };
    }

    const hasGrowth = recentNew > 0 || updated > 0;
    const score: Score = hasGrowth ? 'PASS' : 'WARN';
    return {
      id: 'E-402',
      score,
      result: `${total} pages, ${recentNew} new + ${updated} updated in 7d`,
      value: total,
      severity,
    };
  }

  private checkEntityExtraction(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM entities');
    const totalObs = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    const recent = safeCount(this.db, "SELECT COUNT(*) as cnt FROM entities WHERE first_seen_at > datetime('now', '-7 days')");

    if (total <= 10) {
      return { id: 'E-601', score: 'FAIL', result: `${total} entities from ${totalObs} observations`, value: total, severity };
    }

    // No recent sessions → fall back to total-only
    const recentSessions = safeCount(this.db, "SELECT COUNT(*) as cnt FROM sdk_sessions WHERE started_at > datetime('now', '-7 days')");
    if (recentSessions === 0) {
      return { id: 'E-601', score: 'PASS', result: `${total} entities (no recent sessions)`, value: total, severity };
    }

    const score: Score = recent > 0 ? 'PASS' : 'WARN';
    return {
      id: 'E-601',
      score,
      result: `${total} total, ${recent} new in 7d (${totalObs} obs)`,
      value: total,
      severity,
    };
  }

  private checkFactDensity(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const factCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM facts');
    const entityCount = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM entities');

    if (entityCount === 0) {
      return { id: 'E-602', score: 'FAIL', result: '0 entities', value: 0, severity };
    }

    const ratio = Math.round((factCount / entityCount) * 100) / 100;

    let score: Score = 'FAIL';
    if (ratio >= 2.0) score = 'PASS';
    else if (ratio >= 1.0) score = 'WARN';

    return {
      id: 'E-602',
      score,
      result: `${ratio} facts/entity (${factCount}/${entityCount})`,
      value: ratio,
      severity,
    };
  }

  private checkDiaryEntries(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM agent_diary');

    if (total <= 3) {
      return { id: 'E-701', score: 'FAIL', result: `${total} diary entries`, value: total, severity };
    }

    // Check active days in last 7 days
    const activeDays = safeCount(this.db, "SELECT COUNT(DISTINCT DATE(created_at)) as cnt FROM agent_diary WHERE created_at > datetime('now', '-7 days')");

    // No recent sessions → fall back to total-only
    const recentSessions = safeCount(this.db, "SELECT COUNT(*) as cnt FROM sdk_sessions WHERE started_at > datetime('now', '-7 days')");
    if (recentSessions === 0) {
      return { id: 'E-701', score: 'PASS', result: `${total} entries (no recent sessions)`, value: total, severity };
    }

    const score: Score = activeDays >= 2 ? 'PASS' : 'WARN';
    return {
      id: 'E-701',
      score,
      result: `${total} total, ${activeDays} active days in 7d`,
      value: total,
      severity,
    };
  }

  private checkVectorSync(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const synced = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM sync_state');
    const totalObs = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');

    if (totalObs === 0) {
      return { id: 'E-801', score: 'PASS', result: 'No observations to sync', value: 100, severity };
    }

    if (synced === 0) {
      return { id: 'E-801', score: 'FAIL', result: `0/${totalObs} synced (0%)`, value: 0, severity };
    }

    const pct = (synced / totalObs) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 50) score = 'PASS';
    else if (pct >= 10) score = 'WARN';

    return {
      id: 'E-801',
      score,
      result: `${synced}/${totalObs} synced (${rounded}%)`,
      value: rounded,
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

  // ---- New checks (E-103, E-104, E-205, E-403, E-1002) -------------------

  private checkActiveSessionAccumulation(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const activeCount = safeCount(this.db, "SELECT COUNT(*) as cnt FROM sdk_sessions WHERE status = 'active'");

    let score: Score = 'FAIL';
    if (activeCount <= 5) score = 'PASS';
    else if (activeCount <= 15) score = 'WARN';

    return {
      id: 'E-103',
      score,
      result: `${activeCount} active sessions`,
      value: activeCount,
      severity,
    };
  }

  private checkSessionCompletedAt(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as completed,
        COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as has_end_time
      FROM sdk_sessions WHERE status = 'completed'
    `).get() as { completed: number; has_end_time: number } | null;

    const completed = row?.completed ?? 0;
    const hasEndTime = row?.has_end_time ?? 0;

    if (completed === 0) {
      return { id: 'E-104', score: 'INFO', result: 'No completed sessions', value: null, severity };
    }

    const pct = (hasEndTime / completed) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 80) score = 'PASS';
    else if (pct >= 50) score = 'WARN';

    return {
      id: 'E-104',
      score,
      result: `${rounded}% have completed_at (${hasEndTime}/${completed})`,
      value: rounded,
      severity,
    };
  }

  private checkObservationFactsCoverage(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const total = safeCount(this.db, 'SELECT COUNT(*) as cnt FROM observations');
    if (total === 0) {
      return { id: 'E-205', score: 'FAIL', result: '0 observations', value: 0, severity };
    }

    const hasBoth = safeCount(this.db, `
      SELECT COUNT(*) as cnt FROM observations
      WHERE facts IS NOT NULL AND facts != '' AND facts != '[]'
        AND concepts IS NOT NULL AND concepts != '' AND concepts != '[]'
    `);

    const pct = (hasBoth / total) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 50) score = 'PASS';
    else if (pct >= 30) score = 'WARN';

    return {
      id: 'E-205',
      score,
      result: `${rounded}% have facts+concepts (${hasBoth}/${total})`,
      value: rounded,
      severity,
    };
  }

  private checkKnowledgePageUpdates(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN version > 1 THEN 1 END) as updated
      FROM compiled_knowledge
    `).get() as { total: number; updated: number } | null;

    const total = row?.total ?? 0;
    const updated = row?.updated ?? 0;

    if (total === 0) {
      return { id: 'E-403', score: 'INFO', result: 'No knowledge pages', value: null, severity };
    }

    const pct = (updated / total) * 100;
    const rounded = Math.round(pct * 10) / 10;

    let score: Score = 'FAIL';
    if (pct >= 10) score = 'PASS';
    else if (updated > 0) score = 'WARN';

    return {
      id: 'E-403',
      score,
      result: `${rounded}% updated (${updated}/${total} with version > 1)`,
      value: rounded,
      severity,
    };
  }

  private checkTrendDegradation(severity: typeof EXPECTATIONS[number]['severity']): ExpectationResult {
    // Requires at least 3 historical full reports
    try {
      const rows = this.db.prepare(`
        SELECT score, results, created_at
        FROM doctor_reports
        WHERE mode IN ('full', 'deep')
        ORDER BY created_at DESC
        LIMIT 3
      `).all() as Array<{ score: number; results: string; created_at: string }>;

      if (rows.length < 3) {
        return { id: 'E-1002', score: 'INFO', result: `Only ${rows.length} reports (need 3)`, value: null, severity };
      }

      // Check key metrics: E-201 (obs rate), E-301 (summary coverage), E-801 (vector sync)
      const trackedMetrics = ['E-201', 'E-301', 'E-801'];
      let decliningCount = 0;
      const decliningMetrics: string[] = [];

      for (const metricId of trackedMetrics) {
        const values: number[] = [];
        for (const row of rows) {
          try {
            const results = JSON.parse(row.results) as Record<string, ExpectationResult>;
            const val = results[metricId]?.value;
            if (typeof val === 'number') values.push(val);
          } catch { /* skip malformed */ }
        }

        // rows are newest-first; check if values declined 3 times in a row
        // values[0] = newest, values[1] = middle, values[2] = oldest
        if (values.length === 3 && values[0] < values[1] && values[1] < values[2]) {
          decliningCount++;
          decliningMetrics.push(metricId);
        }
      }

      let score: Score = 'PASS';
      if (decliningCount >= 2) score = 'FAIL';
      else if (decliningCount === 1) score = 'WARN';

      const detail = decliningMetrics.length > 0
        ? `declining: ${decliningMetrics.join(', ')}`
        : 'no sustained decline';

      return {
        id: 'E-1002',
        score,
        result: `${decliningCount}/${trackedMetrics.length} metrics declining (${detail})`,
        value: decliningCount,
        severity,
      };
    } catch {
      return { id: 'E-1002', score: 'INFO', result: 'Could not read report history', value: null, severity };
    }
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
          recs.push(`[HIGH] Low fact density (${r.id}) - Facts per entity ratio below threshold. Fact extraction may need attention.`);
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
        case 'E-103':
          recs.push(`[MEDIUM] Too many active sessions (${r.id}) - Sessions are piling up without completing. Check session lifecycle management.`);
          break;
        case 'E-104':
          recs.push(`[HIGH] Completed sessions missing completed_at (${r.id}) - Session end timestamps not being recorded. Check Stop hook.`);
          break;
        case 'E-205':
          recs.push(`[MEDIUM] Low facts/concepts coverage (${r.id}) - AI extraction not populating facts and concepts fields. Check extraction prompt.`);
          break;
        case 'E-403':
          recs.push(`[MEDIUM] Knowledge pages never updated (${r.id}) - All pages at version 1. Compilation creates but doesn't update existing pages.`);
          break;
        case 'E-1002':
          recs.push(`[HIGH] Sustained metric degradation (${r.id}) - Key metrics declining across consecutive audit runs. Investigate root cause.`);
          break;
      }
    }

    return recs;
  }
}
