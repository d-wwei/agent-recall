---
name: doctor
description: Run Agent Recall health audit. Use when user says "check health", "run doctor", "系统健康", "记忆系统检查", or "agent-recall doctor".
---

# Doctor — Memory System Health Audit

Run health checks on the Agent Recall memory system. Reports a score (0-100), grade (A-F), and actionable recommendations.

## When to Use

- User says "check health", "run doctor", "agent-recall doctor"
- User says "系统健康", "记忆系统检查", "检查记忆系统"
- User asks "is agent recall working?", "memory system status"
- After troubleshooting memory-related issues

## Full Audit

Runs all 16 expectations covering observation capture, session summaries, knowledge compilation, entity extraction, search indexes, and error rates.

1. Call `GET http://localhost:37777/api/doctor`
2. Format the response:

```
## Agent Recall Health Report

**Score:** {score}% | **Grade:** {grade} | **Date:** {created_at}

### Critical Failures
{List critical_failures, or "None" if empty}

### Results by Severity

**CRITICAL**
{For each result where severity=CRITICAL: icon + id + result}

**HIGH**
{For each result where severity=HIGH: icon + id + result}

**MEDIUM**
{For each result where severity=MEDIUM: icon + id + result}

**LOW**
{For each result where severity=LOW: icon + id + result}

### Recommendations
{List each recommendation, or "All checks passed." if empty}
```

Score icons: PASS = "+", WARN = "~", FAIL = "X", INFO = "i"

## Quick Check

When the user wants a fast overview (only CRITICAL items):

1. Call `GET http://localhost:37777/api/doctor/quick`
2. Format only the 3 CRITICAL results (E-201, E-401, E-402)
3. If all pass: "All critical checks passed."
4. If any fail: List failures with recommendations

## History / Trend

When the user asks "health trend", "audit history", "评分趋势":

1. Call `GET http://localhost:37777/api/doctor/history?days={N}` (default N=7)
2. Format as a table:

```
| Date       | Score | Grade | Critical Failures |
|------------|-------|-------|-------------------|
| 2026-04-14 | 86.2  | B     | E-201             |
| 2026-04-13 | 79.0  | C     | E-201, E-401      |
```

## Error Handling

If the worker is not reachable (fetch fails):
> Agent Recall worker is not running. Start it with: `npx agent-recall worker start`

## Expectation Reference

| ID | Name | Severity | What it checks |
|----|------|----------|----------------|
| E-101 | Worker Health | HIGH | Worker process is running |
| E-201 | Observation Rate | CRITICAL | >=3 observations per session |
| E-202 | Type Diversity | MEDIUM | >=4 distinct observation types |
| E-203 | Observation Quality | HIGH | >=80% observations have title |
| E-204 | Deduplication | MEDIUM | >=95% unique content hashes |
| E-301 | Summary Coverage | HIGH | >=50% sessions have summaries |
| E-302 | Summary Structure | HIGH | >=70% summaries fully structured |
| E-401 | Compilation Runs | CRITICAL | >0 compilation runs |
| E-402 | Compiled Knowledge | CRITICAL | >0 knowledge pages |
| E-601 | Entity Extraction | HIGH | >10 entities extracted |
| E-602 | Fact Linking | HIGH | >0 facts linked |
| E-701 | Diary Entries | LOW | >3 diary entries |
| E-801 | Vector Sync | HIGH | >0 sync records |
| E-802 | FTS Index | HIGH | FTS index populated |
| E-901 | Prompt Capture | MEDIUM | >0 prompts captured |
| E-1001 | Error Rate | HIGH | <=5% error rate in logs |
