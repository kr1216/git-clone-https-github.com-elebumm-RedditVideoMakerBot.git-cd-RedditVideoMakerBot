---
title: Projects MOC
type: moc
tags: [claude, moc, projects]
created: 2026-06-29
updated: 2026-06-29
---

# 🗂️ Projects

Each project is a longer-running initiative that spans multiple Claude sessions
across chat, Cowork, and Code. Give each its own note (use the [[Project]]
template) and link sessions up to it via the `project:` frontmatter field.

## All projects

```dataview
TABLE WITHOUT ID
  file.link AS "Project",
  status AS "Status",
  updated AS "Updated"
FROM "claude-memory-hub/030-Projects"
WHERE type = "project"
SORT updated DESC
```

## Sessions grouped by project

```dataview
TABLE WITHOUT ID
  project AS "Project",
  rows.file.link AS "Sessions"
FROM "claude-memory-hub/020-Sessions"
WHERE project
GROUP BY project
SORT project ASC
```

---

*Manual fallback (no Dataview):* list projects here as `[[Project Name]]`.
- 
