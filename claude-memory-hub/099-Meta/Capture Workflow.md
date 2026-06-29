---
title: Capture Workflow
type: meta
tags: [claude, meta, workflow]
created: 2026-06-29
updated: 2026-06-29
---

# 🔄 Capture Workflow

How notes flow in and stay decluttered. Two loops: a **per-session** habit and a
**weekly** triage.

## Per session (≈2 min, do it every time)

1. When a Claude session ends, create one note in `020-Sessions/<surface>/` from
   the matching template: [[Session - Chat]], [[Session - Cowork]],
   [[Session - Code]].
2. Name it `YYYY-MM-DD <short title>`.
3. Fill the frontmatter — especially `project`, `topics`, `status`,
   `next_action`.
4. Write the **TL;DR** and **Open threads** sections. Skip the rest if short.
5. If a real decision happened, add a line to [[Decisions Log]].

That's the whole habit. Everything else (dashboards, project rollups) updates
itself.

## When you're mid-thought and can't stop
Dump it in [[_Inbox]]. Don't worry about structure. Triage it later.

## Weekly triage (≈10 min)

1. **Empty the [[_Inbox]].** Convert each item into a Session note, attach it to
   a Project/Topic, or delete it.
2. **Scan Open threads** on [[Claude Memory Hub]]. For each: still active? move to
   `done`/`archived`, or update `next_action`.
3. **Promote recurring themes** — if the same subject shows up in 3+ sessions,
   give it a [[Topic]] note and tag past sessions with it.
4. **Group into Projects** — if several sessions share a goal, create a [[Project]]
   note and set their `project:` field.
5. **Skim [[Decisions Log]]** so the latest conclusions are fresh before new work.

## Backfilling existing history (one-time)

To pull your *current* scattered conversations into the hub:

1. Export transcripts:
   - Claude.ai chat / Cowork → conversation **⋯ → Export** (or copy text).
   - Claude Code → transcripts under `~/.claude/` on the relevant machine.
2. Drop them into [[_Inbox]].
3. Fastest path: paste a transcript into a fresh Claude session and ask it to
   "summarize this into a Session note using my template" (paste the relevant
   template). Then file the result.
4. Don't try to import everything — backfill only conversations you'd actually
   return to. Decluttering means leaving noise behind.

## Anti-clutter rules (the point of all this)

- **Summaries over transcripts.** Keep the TL;DR + decisions + open threads.
  Paste full transcripts only when you genuinely need the verbatim text.
- **One home per fact.** If it's in a Project/Topic note, link to it.
- **Status honesty.** The Open-threads view is only useful if statuses are real.
- **Inbox near-zero.** A growing inbox is the early warning sign of re-clutter.
