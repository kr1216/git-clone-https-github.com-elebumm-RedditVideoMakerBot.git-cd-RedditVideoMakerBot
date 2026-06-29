---
title: "<Topic name>"
type: topic
tags: [claude, topic]
created: 2026-06-29
updated: 2026-06-29
---

# 🏷️ <Topic name>

> Evergreen thread — collects everything across sessions about this subject.

## What this is
_One-paragraph definition so future-you knows the scope._

## Current understanding / notes
- 

## Sessions touching this topic
```dataview
TABLE WITHOUT ID
  file.link AS "Session",
  surface AS "Where",
  updated AS "Updated"
FROM "claude-memory-hub/020-Sessions"
WHERE contains(topics, this.file.name)
SORT updated DESC
```

## Related
- Projects: [[ ]]
- Other topics: [[ ]]
