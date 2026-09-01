---
name: commit-convention
description: Commit message rules for The Block. Use whenever writing a git commit message in this repo.
---

# Commit convention

Conventional Commits, scoped. **Subject line only — never write a body.**

## Format

```
<type>(<scope>): <message>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

The subject is the entire message. The only thing after it is the trailer.

## Types

`feat` · `fix` · `chore` · `docs` · `refactor` · `perf` · `test` · `style`

## Scopes

| Scope | Covers |
|---|---|
| `agent` | `lib/agent/` — loop, tools, prompts, reflection |
| `db` | `lib/db/`, `lib/seed.ts`, schema |
| `frontend` | `app/`, `components/`, styles, r3f scene |
| `integrations` | Slack, Bedrock config, Vercel, env, cron |
| `docs` | `docs/`, README |
| `submission` | LICENSE, diagram, video assets, Devpost material |

## Rules

- Subject in imperative mood, lowercase after the colon, no trailing period.
- Keep the subject under 72 characters.
- **No body.** No bullet lists, no "why" paragraphs, no `🤖 Generated with` line.
- Always append the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` trailer.
- One logical change per commit. If the subject needs an "and", split the commit.

## Examples

```
feat(frontend): add growth stage geometry for plots
fix(agent): retry decide step on invalid structured output
chore(db): push events schema to turso
docs(docs): record real strands sdk api surface
```

Not this:

```
feat: various updates to the agent and the frontend and some db fixes
```
