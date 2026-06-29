---
title: Claude Memory Hub
type: moc
tags: [claude, hub, moc]
created: 2026-06-29
updated: 2026-06-29
---

# 🧠 Claude Memory Hub

> The single home for everything you do with Claude — **Chat**, **Cowork**, and **Code**.
> Capture each session once, link it, and stop bouncing between conversations.

If you only ever open one note, open this one. Everything below is auto-surfaced
from your notes (Dataview queries) with manual fallbacks underneath.

---

## ⚡ Quick capture

- New session → use a template: [[Session - Chat]] · [[Session - Cowork]] · [[Session - Code]]
- Loose thought → drop it in [[_Inbox]]
- A decision got made → log it in [[Decisions Log]]
- Read this if anything is unclear → [[Conventions]] · [[Capture Workflow]]

---

## 🔥 Open threads (next actions)

> Anything you still need to act on, across every surface.

```dataview
TABLE WITHOUT ID
  file.link AS "Session",
  surface AS "Where",
  status AS "Status",
  next_action AS "Next action"
FROM "claude-memory-hub/020-Sessions"
WHERE status != "done" AND status != "archived"
SORT updated DESC
```

*No Dataview plugin?* Keep a manual list here instead:
- [ ] …

---

## 🕘 Recent sessions

```dataview
TABLE WITHOUT ID
  file.link AS "Session",
  surface AS "Where",
  project AS "Project",
  updated AS "Updated"
FROM "claude-memory-hub/020-Sessions"
SORT updated DESC
LIMIT 15
```

---

## 🗂️ Maps of content

- [[_Projects MOC]] — work grouped by project / initiative
- [[_Topics MOC]] — evergreen topics & recurring threads
- [[Decisions Log]] — what was decided and why

## 📥 Staging

- [[_Inbox]] — unsorted captures waiting to be filed

---

## 🧭 How this hub works (30-second version)

1. **Every Claude session becomes one note** in `020-Sessions/<surface>`.
2. Each note carries **frontmatter** (`surface`, `project`, `topics`, `status`,
   `next_action`) so the dashboards above stay current automatically.
3. **Link, don't copy.** Reference projects/topics with `[[wikilinks]]` so
   context from chat shows up next to context from code.
4. **Decisions and open threads bubble up here** so you never re-read an old
   chat just to remember what you concluded.

Full details: [[Conventions]] and [[Capture Workflow]].
