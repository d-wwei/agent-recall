# Recall — Session History Search

Search your past work across sessions using temporal or topic-based recall.

## How It Works

This skill queries the session archives via the Agent Recall API.

## Temporal Recall

When the user asks "what did I do yesterday?", "last week's work", etc:

1. Calculate the date range as epoch milliseconds
2. Call `GET http://localhost:37777/api/archives/temporal?from=EPOCH&to=EPOCH&project=PROJECT`
3. Group results by day and format as a timeline:

```
## 2026-03-25 (2 sessions)
- 14:30 [30min] Completed JWT auth module #auth #backend
- 16:00 [20min] Fixed bundle size regression #performance

## 2026-03-24 (1 session)
- 10:00 [45min] Designed database schema for user profiles #database #design
```

## Topic Recall

When the user asks "recall work on authentication", "之前做过 X 吗", etc:

1. Extract the topic keyword
2. Call `GET http://localhost:37777/api/archives/search?query=KEYWORD&project=PROJECT`
3. Format results grouped by relevance

## Memory Promotion

When the user says "sync this to global" or "同步到全局":

1. Call `GET http://localhost:37777/api/promotion/detect?project=PROJECT`
2. Present promotable items to the user
3. For each item the user approves: `POST http://localhost:37777/api/promotion/sync` with `{ "observation_id": ID }`

## Sync Policy

Set per-project sync policy:
- "always sync" → `POST http://localhost:37777/api/promotion/policy` with `{ "project": "X", "action": "always" }`
- "never sync" → `{ "action": "never" }`
- "ask each time" → `{ "action": "ask" }`
