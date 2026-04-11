# Agent Recall — Viewer UI Enhancements Design

> Date: 2026-04-11
> Status: Draft
> Author: Eli + Claude

---

## Problem

The Dashboard component has basic stat cards, type distribution, top concepts, and freshness bar. But several backend capabilities have no UI representation: search result explanations, compilation status/history, Mermaid diagrams, and LLM cost tracking.

## Solution

Four UI enhancements, no new npm dependencies:

1. **Search result explanation** — Show match score, type, and keyword highlights on search results
2. **Compilation status section** — Last compile time, pages, lint warnings detail, AI merge status
3. **Mermaid diagram rendering** — Render stored Mermaid diagrams via CDN script
4. **LLM cost tracking section** — Token usage, estimated cost, compilation history table

---

## 1. Search Result Explanation

**Location:** SearchExplanation.tsx (already exists but may need enhancement)

**Data source:** SearchExplainer returns `{ matchScore, matchType, matchedKeywords, source }` per result.

**UI:** Inline badge on each search result card showing:
- Score badge: colored by range (green > 0.7, amber > 0.4, red < 0.4)
- Match type label: "semantic" / "keyword" / "hybrid"
- Highlighted keywords in the result text

**Backend change:** Ensure search API includes explanation data in response. Check if `/api/search` already returns explainer data — if not, add it.

---

## 2. Compilation Status Section

**Location:** New section in Dashboard.tsx

**Data source:** New API endpoint `GET /api/compilation/stats?project=<name>`

**Response shape:**
```typescript
interface CompilationStats {
  lastCompilation: {
    completedAt: string;
    durationMs: number;
    observationsProcessed: number;
    pagesCreated: number;
    pagesUpdated: number;
    tokensUsed: number;
    status: 'success' | 'failed';
  } | null;
  totalRuns: number;
  successRate: number;        // 0-1
  aiMergeActive: boolean;
  aiMergeModel: string;
  lintWarnings: Array<{
    type: string;
    description: string;
    observationId?: number;
  }>;
}
```

**UI:**
- Stat row: "Last compiled X ago" | "Y pages" | "Z observations processed"
- AI merge status badge: "AI merge: active (model)" or "text merge"
- If lint warnings > 0: expandable list of warnings with type icons
- If no compilations yet: "No compilations yet. Knowledge will be compiled after 5 sessions."

---

## 3. Mermaid Diagram Rendering

**Location:** New section in Dashboard.tsx

**Data source:** New API endpoint `GET /api/compilation/diagrams?project=<name>`

Returns compiled_knowledge entries where `topic = '_mermaid_diagrams'`:
```typescript
interface DiagramData {
  content: string;       // Raw Mermaid code blocks
  compiledAt: string;
  version: number;
}
```

**UI:**
- Collapsible section "Architecture Diagrams"
- Each mermaid code block rendered as SVG via mermaid.js
- Mermaid loaded from CDN: `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js`
- Fallback: if CDN fails or mermaid parse errors, show raw code block
- "Last updated: X" timestamp

**Mermaid integration pattern:**
```typescript
useEffect(() => {
  if (window.mermaid && containerRef.current) {
    window.mermaid.run({ nodes: containerRef.current.querySelectorAll('.mermaid') });
  }
}, [diagramContent]);
```

Load mermaid script in viewer-template.html via `<script>` tag.

---

## 4. LLM Cost Tracking Section

**Location:** New section in Dashboard.tsx

**Data source:** Same `/api/compilation/stats` endpoint, plus `GET /api/compilation/logs?project=<name>&limit=10`

**Logs response:**
```typescript
interface CompilationLog {
  id: number;
  completedAt: string;
  durationMs: number;
  observationsProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  tokensUsed: number;
  status: string;
}
```

**UI:**
- Summary row: "Total tokens: X" | "Est. cost: $Y/month"
- Cost estimation: tokens × model price rate (configurable, default Opus pricing)
- Recent compilations table: date | duration | pages | tokens | status
- If no token usage: "AI merge not configured — using text merge (free)"

---

## New API Endpoints

| Endpoint | Handler | Data Source |
|----------|---------|-------------|
| `GET /api/compilation/stats?project=` | CompilationRoutes.ts (new) | CompilationLogger + KnowledgeLint + settings |
| `GET /api/compilation/logs?project=&limit=` | CompilationRoutes.ts (new) | compilation_logs table |
| `GET /api/compilation/diagrams?project=` | CompilationRoutes.ts (new) | compiled_knowledge WHERE topic='_mermaid_diagrams' |

---

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/services/worker/http/routes/CompilationRoutes.ts` | 3 API endpoints for compilation data |
| `src/ui/viewer/components/CompilationStatus.tsx` | Compilation status + lint warnings section |
| `src/ui/viewer/components/MermaidDiagrams.tsx` | Mermaid diagram rendering section |
| `src/ui/viewer/components/LLMCostTracker.tsx` | Token usage + cost estimation section |

### Modified Files

| File | Change |
|------|--------|
| `src/ui/viewer/components/Dashboard.tsx` | Import and render 3 new sections |
| `src/ui/viewer/viewer-template.html` | Add CSS for new sections + mermaid CDN script |
| `src/services/worker-service.ts` | Register CompilationRoutes |
| `src/ui/viewer/components/SearchExplanation.tsx` | Enhance with score badge and keyword highlights |

---

## Costs

| Dimension | Estimate |
|-----------|----------|
| New code | ~400-600 lines TSX + ~100 lines CSS + ~150 lines route handler |
| New dependencies | 0 (Mermaid via CDN) |
| Runtime cost | Zero |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Mermaid CDN unavailable | Low | Show raw code block as fallback |
| compilation_logs empty | None | Empty state message |
| Mermaid parse error | Low | Catch error, show raw code |
| Large diagram overflows | Low | Scrollable container with max-height |

---

## Success Criteria

1. Dashboard shows compilation status with last compile time and AI merge state
2. Mermaid diagrams render as SVG when available
3. LLM cost tracking shows token usage and estimated monthly cost
4. Search results show match explanation when available
5. All new sections handle empty state gracefully
6. No new npm dependencies added
