---
title: Conventions
type: meta
tags: [claude, meta, conventions]
created: 2026-06-29
updated: 2026-06-29
---

# 📐 Conventions

The small set of rules that keep this hub from re-cluttering. Keep it boring and
consistent — that's what makes the dashboards work.

## 1. One note per session
Every Claude session (chat, Cowork, or Code) becomes exactly **one note** in
`020-Sessions/<surface>/`. Don't split a single conversation across notes; don't
merge unrelated conversations into one.

## 2. Frontmatter is the source of truth
The dashboards in [[Claude Memory Hub]], [[_Projects MOC]], and [[_Topics MOC]]
are built from frontmatter. Always fill these on a session note:

| Field | Values | Purpose |
|---|---|---|
| `type` | `session` | Identifies it for queries |
| `surface` | `chat` / `cowork` / `code` | Which Claude surface |
| `project` | `[[Project Name]]` | Rolls the session up to a project |
| `topics` | `[Topic A, Topic B]` | Cross-session threads |
| `status` | `active` / `waiting` / `done` / `archived` | Drives the "open threads" view |
| `next_action` | free text | Shows up in the home dashboard |
| `updated` | `YYYY-MM-DD` | Sort key for "recent" |

## 3. Tags = surface + type, nothing fancy
Use a **small, fixed** tag vocabulary. More tags ≠ more organized.
- Surface: `#chat`, `#cowork`, `#code`
- Type: `#session`, `#project`, `#topic`, `#decision`
- Avoid ad-hoc tags; prefer linking to a [[Topic]] note instead.

## 4. Link, don't duplicate
If context already lives in a Project, Topic, or People note, **link to it**
with `[[wikilinks]]` rather than pasting it again. This is what lets context from
a chat sit right next to context from Code.

## 5. Naming
- Sessions: `YYYY-MM-DD <short title>` (date-prefix keeps them sorted).
- Projects / Topics: plain descriptive name (becomes the wikilink target).
- Decisions: `Decision — <short title>`.

## 6. Status lifecycle
`active` → `waiting` (blocked on someone/something) → `done` → `archived`.
Anything not `done`/`archived` shows up under **Open threads** on the home page,
so be honest about status — that list is your cross-chat memory.

## 7. Decisions get logged twice (on purpose)
A meaningful decision goes (a) in the session note where it happened, and (b) as
a row/entry in [[Decisions Log]]. The duplication is cheap and means you never
have to reopen a transcript to recover a conclusion.
