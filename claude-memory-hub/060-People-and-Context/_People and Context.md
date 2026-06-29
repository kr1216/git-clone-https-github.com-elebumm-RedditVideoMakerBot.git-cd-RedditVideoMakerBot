---
title: People & Context
type: moc
tags: [claude, moc, context]
created: 2026-06-29
updated: 2026-06-29
---

# 👥 People & Context

Reusable context you keep re-explaining to Claude. Put each stable thing in its
own note here, then **link to it** from sessions instead of re-typing it. This is
how you stop re-establishing the same background in every new chat.

Good candidates:
- **People** — collaborators, clients, their roles/preferences.
- **Accounts & environments** — repos, stacks, tools you use (no secrets — see below).
- **Standing preferences** — how you like answers, code style, tone.
- **Recurring background** — "what my product does", "my constraints".

```dataview
LIST
FROM "claude-memory-hub/060-People-and-Context"
WHERE file.name != this.file.name
SORT file.name ASC
```

> ⚠️ **Never store secrets here** — no API keys, tokens, or passwords. This is
> notes, and notes get synced/shared. Keep credentials in a password manager and
> reference them by name only.
