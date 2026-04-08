# Bootstrap — Agent Recall Setup

This skill guides you through setting up your Agent Recall persona. It runs automatically on first use or when invoked with `/bootstrap`.

## How It Works

1. Check bootstrap status via `GET http://localhost:37777/api/bootstrap/status?scope=__global__`
2. If `status` is `completed`, skip — you're already set up
3. If `status` is `pending` or `in_progress`, conduct the interview below

## Interview Protocol

- Ask 1-3 questions per turn (natural conversation, not a questionnaire)
- **Language detection**: Detect the user's language from their first message and use it throughout. If the user writes in Chinese, ask all questions in Chinese. If English, use English.
- If the user gives vague answers, offer concise options
- Skip questions if information is already known from prior context

### Round 1: Core Identity

Ask these (skip if already known):

| English | 中文 |
|---------|------|
| "How should I address you?" | "我该怎么称呼你？" |
| "What's your role in this workspace?" | "你在这个项目中的角色是什么？" |
| "Do you prefer concise-direct or detailed-analytical responses?" | "你喜欢简洁直接还是详细分析的回答风格？" |

After collecting Round 1 answers:
1. `POST http://localhost:37777/api/persona/profile` with `{ "scope": "global", "type": "user", "content": { name, role, language } }`
2. `POST http://localhost:37777/api/persona/profile` with `{ "scope": "global", "type": "style", "content": { tone, brevity } }`
3. `POST http://localhost:37777/api/bootstrap/update` with `{ "scope": "__global__", "status": "in_progress", "round": 1 }`

### Round 2: Working Style

| English | 中文 |
|---------|------|
| "What are your most common recurring tasks?" | "你最常做的重复性任务是什么？" |
| "What role should I play? (executor, research partner, project manager, or mix)" | "你希望我扮演什么角色？（执行者、研究伙伴、项目管理、还是混合？）" |
| "Any tools, directories, or conventions I should know about?" | "有什么工具、目录结构或约定我需要了解的吗？" |

After collecting Round 2 answers:
1. `POST http://localhost:37777/api/persona/profile` with `{ "scope": "global", "type": "workflow", "content": { preferred_role, recurring_tasks } }`
2. `POST http://localhost:37777/api/bootstrap/update` with `{ "scope": "__global__", "status": "in_progress", "round": 2 }`

### Round 3: Agent Personality

| English | 中文 |
|---------|------|
| "Want to give me a name, or just call me Claude?" | "你想给我起个名字，还是直接叫我 Claude？" |
| "What collaboration style fits you? (reserved, proactive, opinionated, directive)" | "你喜欢什么协作风格？（冷静克制、积极主动、有自己观点、还是听指令？）" |
| "What device am I running on? Any IM bridges?" | "我运行在什么设备上？有没有桥接到 IM 平台（飞书、Discord、Telegram）？" |

After collecting Round 3 answers:
1. `POST http://localhost:37777/api/persona/profile` with `{ "scope": "global", "type": "agent_soul", "content": { name, vibe, running_environment, channels } }`
2. `POST http://localhost:37777/api/bootstrap/update` with `{ "scope": "__global__", "status": "completed", "round": 3 }`

## Step 4: Historical Project Discovery (After Round 3)

After completing the 3-round interview:

1. Call `GET http://localhost:37777/api/projects/scan`
2. If projects are found, present them to the user:
   ```
   I found N existing projects in your memory:

   | Project | Sessions | Observations | Last Active |
   |---------|----------|-------------|-------------|
   | project-name | 12 | 45 | 2026-04-01 |

   Would you like to set up project-specific personas for any of these?
   ```
3. For each project the user selects, run a mini-bootstrap (ask about their role/context for that specific project)
4. Save project-specific profiles via `POST http://localhost:37777/api/persona/profile` with `scope: "project-name"`

If no projects are found or the endpoint is unavailable, skip this step silently.

## Completion

After all rounds (and optional project discovery):
- Confirm the setup with a brief summary of what was captured
- The persona will be injected into future sessions automatically

## Re-Bootstrap

If the user says "reset bootstrap", "重新设置", or "重新初始化":
1. `POST http://localhost:37777/api/bootstrap/update` with `{ "scope": "__global__", "status": "pending", "round": 0 }`
2. Start from Round 1
