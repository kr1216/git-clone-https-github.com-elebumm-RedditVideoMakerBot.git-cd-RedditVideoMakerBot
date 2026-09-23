# CLAUDE.md

This file gives AI assistants (e.g. Claude Code) the context needed to work
effectively in this repository.

## ⚠️ Current repository state

The RedditVideoMakerBot code has **not** been added. The repo currently contains:

- `README.md`: a single-line placeholder.
- `CLAUDE.md`: this file.
- `docs/vixyvault-analysis.md`: a teardown of vixxyvault.com (a Kalshi 15-minute
  crypto prediction site) and the design rationale for `kalshi15m/`.
- `kalshi15m/`: a paper-only Python 3.11 fair-value engine for Kalshi 15-minute
  "price ≥ strike" markets (`model.py` math, `engine.py` gate, `feeds.py` Kalshi
  REST + Coinbase WS, `__main__.py` loop). Run: `python -m kalshi15m --series KXBTC15M`.
  It never places orders.
- `tests/test_kalshi15m.py`: offline unit tests. Install: `pip install -r requirements.txt`.
  Test: `python -m pytest -q tests`.

Verify with `git ls-files` before assuming anything else exists.

## Intended purpose

The repository name —
`git-clone-https-github.com-elebumm-RedditVideoMakerBot.git-cd-RedditVideoMakerBot`
— references the open-source **RedditVideoMakerBot** project
(https://github.com/elebumm/RedditVideoMakerBot). That upstream project is a
Python tool that automatically generates short-form narrated videos from
Reddit threads (scrape a post/comments → text-to-speech → screenshots of
comments → composite over a background video).

**Important:** none of that upstream code is currently checked into this
repository. Treat the project description above as *intended direction only*,
not as a description of code that exists here. If you are asked to "fix",
"document", or "modify" the RedditVideoMakerBot code, first confirm whether the
code has actually been added — if the working tree is still just `README.md`,
the code needs to be brought in before such work is possible.

## Working in this repository

### Before doing anything
1. Run `git ls-files` and `ls -la` to see what actually exists right now.
2. Re-read this file critically — if it describes structure that the working
   tree no longer matches, trust the working tree and update this file.

### Git workflow
- Default branch: `main`.
- Active development branch for AI-assisted work: the branch named in the session instructions.
- Do all work on the designated feature branch; never push directly to `main`
  without explicit permission.
- Push with `git push -u origin <branch-name>`.
- Do not open a pull request unless explicitly asked.
- Commit with clear, descriptive messages.

### If/when the RedditVideoMakerBot code is added
Once real source code lands, this file should be expanded to document the
actual structure. The upstream project conventionally includes (verify before
relying on any of these):

- `main.py` — entry point / orchestration.
- `reddit/` — Reddit scraping (PRAW-based).
- `video_creation/` — TTS, screenshots (Playwright), and ffmpeg compositing.
- `TTS/` — pluggable text-to-speech engines.
- `utils/` — config parsing, console output, helpers.
- `requirements.txt` — Python dependencies.
- `config.toml` / `utils/.config.template.toml` — runtime configuration.

When updating this section, replace these assumptions with verified facts:
real file paths, the actual Python version, the real dependency manager, how to
install, how to run, and how to test.

## Conventions for updating this file
- Keep this file truthful about the *current* state of the repo. Do not
  document aspirational structure as if it exists.
- When you add code, update the relevant section in the same change so this
  file never drifts from reality.
- Prefer concrete, verifiable instructions (exact commands, exact paths) over
  general description.
