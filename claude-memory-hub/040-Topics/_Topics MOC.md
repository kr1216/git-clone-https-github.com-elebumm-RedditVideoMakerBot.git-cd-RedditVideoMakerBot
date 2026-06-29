---
title: Topics MOC
type: moc
tags: [claude, moc, topics]
created: 2026-06-29
updated: 2026-06-29
---

# 🏷️ Topics

Topics are **evergreen threads** that recur across many sessions and projects —
e.g. a tool you keep using, a concept you keep refining, a recurring question.
Unlike projects, topics don't "finish." Give each one a note (use the [[Topic]]
template) so scattered chat/Cowork/Code mentions collect in one place.

## All topics

```dataview
TABLE WITHOUT ID
  file.link AS "Topic",
  updated AS "Updated"
FROM "claude-memory-hub/040-Topics"
WHERE type = "topic"
SORT file.name ASC
```

## Sessions grouped by topic

```dataview
TABLE WITHOUT ID
  rows.file.link AS "Sessions"
FROM "claude-memory-hub/020-Sessions"
FLATTEN topics AS topic
WHERE topic
GROUP BY topic
SORT topic ASC
```

---

*Manual fallback (no Dataview):* list topics here as `[[Topic Name]]`.
- 
