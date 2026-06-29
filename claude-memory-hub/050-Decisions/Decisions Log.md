---
title: Decisions Log
type: decisions-log
tags: [claude, decisions, log]
created: 2026-06-29
updated: 2026-06-29
---

# ✅ Decisions Log

The antidote to "wait, what did we decide in that other chat?" Every time a
conclusion is reached in any Claude session, log one line here and link back to
the session. This is the page you skim before starting new work.

Add new decisions at the **top**. Use the [[Decision]] template for ones that
need full rationale; quick ones can just be a row below.

## Quick log

| Date | Decision | Surface | Source | Status |
|------|----------|---------|--------|--------|
| 2026-06-29 | Adopt the Claude Memory Hub structure to centralize chat/Cowork/Code notes | code | [[Claude Memory Hub]] | active |

## Detailed decisions

```dataview
TABLE WITHOUT ID
  file.link AS "Decision",
  date AS "Date",
  status AS "Status"
FROM "claude-memory-hub/050-Decisions"
WHERE type = "decision"
SORT date DESC
```

---

*Why keep this separate from session notes?* Because decisions outlive the
conversation that produced them. Centralizing them here means you never reread an
old transcript just to recover the conclusion.
