---
title: "<Project name>"
type: project
status: active   # active | paused | done | archived
topics: []
tags: [claude, project]
created: 2026-06-29
updated: 2026-06-29
---

# 📁 <Project name>

> **Status:** active

## Goal
_What are you trying to accomplish? Definition of done._

## Current state
_Where things stand right now — the thing you'd want to know if you came back
after two weeks away._

## Sessions in this project
```dataview
TABLE WITHOUT ID
  file.link AS "Session",
  surface AS "Where",
  status AS "Status",
  updated AS "Updated"
FROM "claude-memory-hub/020-Sessions"
WHERE project = this.file.link OR contains(project, this.file.name)
SORT updated DESC
```

## Key decisions
- _Link to [[Decisions Log]] entries or [[Decision]] notes._

## Open threads / next actions
- [ ] 

## Related
- Topics: 
- People/context: [[ ]]
