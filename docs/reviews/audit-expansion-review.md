---
status: DONE_WITH_CONCERNS
reviewers: [security, correctness, spec-compliance, adversarial]
scope: src/services/doctor/DoctorService.ts, src/services/doctor/expectations.ts, monitor/EXPECTATIONS.md, monitor/audit.sh
date: 2026-04-15
---

# Review: Audit System Expansion (5 New Checks + E-602 Upgrade)

## Summary

Added 5 new health checks (E-103, E-104, E-205, E-403, E-1002) and upgraded E-602 from binary (facts > 0) to ratio-based (facts_per_entity >= 2.0). Also fixed pre-existing `score_add` integer arithmetic bug in audit.sh.

**Files changed**: 4 files, +244 -12 lines (TypeScript), shell script and markdown updates outside git.

**Status**: DONE_WITH_CONCERNS — all P0/P1/P2 resolved, two P3 deferred.

---

## Security Reviewer Findings

No security issues found. Changes are read-only SQL queries against SQLite (no user input in queries, all parameterized or literal). No new endpoints, no authentication changes, no data exposure.

---

## Correctness Reviewer Findings

### Finding: E-602 bc leading-zero edge case (RESOLVED)
- **Severity**: P2
- **Persona**: Correctness
- **Confidence**: high
- **File**: `monitor/audit.sh:259`
- **Description**: `bc` outputs `.50` without leading zero for values < 1.0, causing `cut -d. -f1` to return empty string.
- **Evidence**: `echo "scale=2; 1/2" | bc` → `.50`
- **Suggested fix**: Wrap with `printf "%.2f"` to ensure leading zero.
- **Autofix class**: safe_auto
- **Resolution**: Fixed. `printf "%.2f"` applied.

### Finding: score_add integer arithmetic loses precision (RESOLVED)
- **Severity**: P1
- **Persona**: Correctness
- **Confidence**: high
- **File**: `monitor/audit.sh:364-368`
- **Description**: Integer division for WARN half-credit: CRITICAL(3)/2=1 (should be 1.5), MEDIUM(1)/2=0 (should be 0.5). LOW weight was 1 instead of 0.5. INFO/N/A not excluded.
- **Evidence**: DoctorService uses floats, audit.sh used integers. Scoring divergence.
- **Suggested fix**: Rewrite score_add with `bc` for floating-point arithmetic, exclude INFO/N/A.
- **Autofix class**: manual
- **Resolution**: Fixed. score_add rewritten with `bc`, E-701 weight changed to 0.5, INFO/N/A early return added.

### Finding: runFull() docstring says "16 expectations" (RESOLVED)
- **Severity**: P2
- **Persona**: Correctness
- **Confidence**: high
- **File**: `src/services/doctor/DoctorService.ts:69`
- **Description**: Method JSDoc still said "Run all 16 expectations" after adding 5 new ones.
- **Evidence**: grep for "16 expectations"
- **Suggested fix**: Change to "21 expectations"
- **Autofix class**: safe_auto
- **Resolution**: Fixed.

### Finding: E-1002 only queries mode='full' reports (RESOLVED)
- **Severity**: P2
- **Persona**: Correctness
- **Confidence**: medium
- **File**: `src/services/doctor/DoctorService.ts:1043`
- **Description**: `runDeep()` stores reports as `mode='deep'`, which also contain full results. Excluding them reduces available history.
- **Suggested fix**: `WHERE mode IN ('full', 'deep')`
- **Autofix class**: safe_auto
- **Resolution**: Fixed.

### Finding: E-205 returns FAIL on 0 observations instead of INFO
- **Severity**: P3
- **Persona**: Correctness
- **Confidence**: low
- **File**: `src/services/doctor/DoctorService.ts:981`, `monitor/audit.sh:334`
- **Description**: When there are 0 observations, E-205 returns FAIL, which penalizes the score. E-104 and E-403 return INFO for empty data. However, 0 observations also causes E-201 FAIL (CRITICAL), so this is double-penalizing.
- **Autofix class**: advisory
- **Resolution**: Deferred to next iteration. Consistent between Doctor and audit.sh. Low impact since 0 observations is an extreme edge case.

---

## Spec Compliance Reviewer Findings

### Threshold Consistency Cross-Check: ALL PASS

| Check | EXPECTATIONS.md | DoctorService.ts | audit.sh | Match |
|-------|----------------|-------------------|----------|-------|
| E-103 | PASS<=5; WARN<=15; FAIL>15 | <=5/<=15/else | <=5/<=15/else | YES |
| E-104 | PASS>=80%; WARN>=50%; FAIL<50% | >=80/>=50/else | >=80/>=50/else | YES |
| E-205 | PASS>=50%; WARN>=30%; FAIL<30% | >=50/>=30/else | >=50/>=30/else | YES |
| E-403 | PASS>=10%; WARN>0%; FAIL=0% | >=10/>0/else | >=10/>0/else | YES |
| E-602 | PASS>=2.0; WARN>=1.0; FAIL<1.0 | >=2.0/>=1.0/else | >=2/>=1/else | YES |
| E-1002 | PASS no decline; WARN 1; FAIL 2+ | Same | N/A (Doctor only) | YES |

### Scoring Weight Cross-Check: ALL PASS

| Check | Severity | Weight | DoctorService | audit.sh | Match |
|-------|----------|--------|---------------|----------|-------|
| E-103 | MEDIUM | 1x | 1 | 1 | YES |
| E-104 | HIGH | 2x | 2 | 2 | YES |
| E-205 | MEDIUM | 1x | 1 | 1 | YES |
| E-403 | MEDIUM | 1x | 1 | 1 | YES |
| E-602 | HIGH | 2x | 2 | 2 | YES |
| E-1002 | HIGH | 2x | 2 | N/A | YES |
| E-701 | LOW | 0.5x | 0.5 | 0.5 | YES |

### Finding: E-102 defined in EXPECTATIONS.md but never implemented
- **Severity**: P3
- **Persona**: Spec Compliance
- **Confidence**: medium
- **File**: `monitor/EXPECTATIONS.md:26-30`
- **Description**: Pre-existing gap. E-102 (Worker shuts down cleanly) is defined in the spec but not implemented in any code.
- **Autofix class**: advisory
- **Resolution**: Deferred. Pre-existing, not introduced by this change.

---

## Adversarial Reviewer Findings

### Assumption Violation: E-1002 trend detection with sparse data
- **Severity**: P3
- **Persona**: Adversarial
- **Confidence**: medium
- **File**: `src/services/doctor/DoctorService.ts:1040-1080`
- **Description**: E-1002 requires exactly 3 consecutive reports with numeric values for each tracked metric. If a metric returned INFO/null in any of the 3 reports (e.g., E-801 when there were 0 observations), its values array has < 3 entries and the declining check is silently skipped. This means a metric that alternates between numeric and null never triggers trend detection.
- **Evidence**: Code checks `values.length === 3` before comparing.
- **Impact**: Low. In practice, E-201/E-301/E-801 almost always return numeric values. Only edge case is a brand-new deployment with < 3 reports (where E-1002 returns INFO anyway).
- **Resolution**: Acceptable behavior. INFO return for insufficient data is the correct fallback.

### Composition Failure: audit.sh and DoctorService scoring divergence window
- **Severity**: P3
- **Persona**: Adversarial
- **Confidence**: low
- **Description**: E-1002 adds 2x HIGH weight in Doctor but not in audit.sh. When E-1002 returns INFO (excluded from total), scores match. When E-1002 returns PASS/WARN/FAIL, Doctor has a different denominator than audit.sh. This is by design (Doctor-only check) but means the two systems will never produce identical scores once E-1002 becomes active.
- **Impact**: Acceptable. User's spec explicitly states E-1002 is Doctor-only. The <2% divergence tolerance is met for shared checks.

---

## Verification Evidence

```
$ AUDIT_DAYS=1 /bin/zsh monitor/audit.sh
Score: 99.2% (Grade: A)
E-103: [PASS] 5 active sessions
E-104: [PASS] 100.0% have completed_at (87/87)
E-205: [PASS] 100.0% have facts+concepts (553/553)
E-403: [PASS] 27.2% updated (33/121 with version > 1)
E-602: [PASS] 2.75 facts/entity (1958/712)
E-1001: [PASS] .45% error rate (92/20217)
```

All new checks produce expected results. Thresholds consistent across all three sources.

---

## Auto-Fixes Applied

1. `printf "%.2f"` wrapping for bc output (E-602 in audit.sh)
2. score_add rewritten with bc floating-point arithmetic
3. E-701 weight corrected from 1 to 0.5
4. INFO/N/A exclusion added to score_add
5. runFull() docstring updated from "16" to "21"
6. E-1002 query updated to include mode='deep'

## Suppressed Findings

None.

## Deferred P3 Items

1. E-205 FAIL vs INFO on 0 observations — next iteration
2. E-102 unimplemented in code — pre-existing, not in scope
