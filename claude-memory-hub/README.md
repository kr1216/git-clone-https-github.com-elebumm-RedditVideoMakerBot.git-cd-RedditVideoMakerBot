# Claude Memory Hub

A drop-in **Obsidian** structure that becomes the single home for everything you
do with Claude — **Claude.ai chat**, **Cowork**, and **Claude Code** — so you
stop bouncing between conversations to remember what was said or decided.

> ⚠️ **Why this is a scaffold, not your filled-in vault:** this was generated in
> an isolated cloud container that has **no access to your local Obsidian vault
> or your Claude chat/Cowork history**. It can't read your past conversations.
> What it *can* do is give you a clean, opinionated system + templates so that
> from here on, every Claude interaction lands in one organized place. See
> "Backfilling old conversations" below to pull existing history in.

## Install into your vault (2 minutes)

1. Copy the whole `claude-memory-hub/` folder into your Obsidian vault
   (anywhere — top level is fine).
2. Open Obsidian → open `000-Index/Claude Memory Hub.md`. That's your home base.
3. (Recommended) Install the **Dataview** community plugin so the dashboards on
   the home page auto-populate. Without it, the manual fallback lists still work.
4. (Optional) Install **Templater** or use Obsidian's core **Templates** plugin
   and point it at `090-Templates/` so new notes are one hotkey away.
5. (Optional) Pin `Claude Memory Hub.md` and set it as your startup note
   (Settings → there are plugins for this, or just keep it pinned).

## Folder layout

| Folder | What lives here |
|---|---|
| `000-Index/` | The home note / map of content. Start here. |
| `010-Inbox/` | Quick, unsorted captures. Triage into Sessions/Projects later. |
| `020-Sessions/` | **One note per Claude session**, split into `Chat/`, `Cowork/`, `Code/`. |
| `030-Projects/` | Longer-running initiatives. Sessions link up to a project. |
| `040-Topics/` | Evergreen, cross-session topics (e.g. "TTS", "Video pipeline"). |
| `050-Decisions/` | A running decisions log so conclusions survive past any one chat. |
| `060-People-and-Context/` | Reusable context blocks: people, accounts, prefs. |
| `090-Templates/` | Copy-paste / Templater templates for each note type. |
| `099-Meta/` | The conventions + capture workflow that keep it from re-cluttering. |

## The one habit that makes this work

**End each Claude session by saving it as one note.** Use the matching template,
fill the frontmatter (especially `status` and `next_action`), and link it to a
project/topic. That's it — the home dashboard and decisions log assemble
themselves from those notes.

## Backfilling old conversations

To bring your *existing* Claude history into this system:

- **Claude.ai chat / Cowork:** open a conversation → **⋯ menu → Export** (or
  copy the transcript). Drop the markdown into `010-Inbox/`, then split each
  meaningful conversation into a Session note using the templates.
- **Claude Code:** session transcripts live under `~/.claude/` on the machine
  where you ran Code. Copy the relevant ones into `010-Inbox/` and summarize.
- Then run the triage pass described in `099-Meta/Capture Workflow.md`.

You can also paste transcripts into a Claude session and ask it to convert them
into Session notes using these templates — that's the fastest way to backfill in
bulk.

## Conventions at a glance

- **Surface** tag on every session: `#chat`, `#cowork`, or `#code`.
- **Status** values: `active`, `waiting`, `done`, `archived`.
- **Link, don't duplicate.** Reference `[[Projects]]` and `[[Topics]]` with
  wikilinks instead of re-pasting context.

Full rules: `099-Meta/Conventions.md`.
