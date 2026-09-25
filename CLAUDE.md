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
  "price ≥ strike" markets. It never places orders.
  - `model.py`: P(final-minute 60s average ≥ strike), Kalshi fee, EV.
  - `engine.py`: decision gate (edge after fees, time window, staleness, `vol_mult`).
  - `assets.py`: per-asset series, Coinbase product, volatility multiplier and minimum edge.
  - `feeds.py`: Kalshi REST (current market) and Coinbase WebSocket spot.
  - `__main__.py`: live paper loop, `python -m kalshi15m --series KXBTC15M`.
  - `backtest.py`: replays Kalshi's settled markets with Kalshi's real 1-minute
    Yes bid/ask and Coinbase 1-minute spot; reports P&L per contract and model
    Brier vs Kalshi-mid Brier. `python -m kalshi15m.backtest --series KXBTC15M --markets 300`.
- `web/strike-desk.html`: source of the mobile "Strike Desk" claude.ai artifact
  (https://claude.ai/artifact/89KZ3DTCWGimbqxXQuHTUx). Same math in JS; live spot via
  the Crypto.com connector, manual Kalshi inputs, journal in the artifact db,
  per-asset defaults in `PROFILES` (keep in sync with `kalshi15m/assets.py`).
- `tests/`: offline unit tests. Install: `pip install -r requirements.txt`.
  Test: `python -m pytest -q tests`.

## Kalshi runbook (next session with network access)

Kalshi market data is public: no API key is needed for any of this. Check access
first: `curl -s -o /dev/null -w "%{http_code}\n" https://api.elections.kalshi.com/trade-api/v2/exchange/status`
must print 200. If it prints 000, the environment's network policy still blocks it.

1. `pip install -r requirements.txt && python -m pytest -q tests`
2. Backtest BTC on Kalshi's own history (the grade that matters):
   `python -m kalshi15m.backtest --series KXBTC15M --markets 300`.
   The model has an edge only if its Brier is below Kalshi-mid Brier AND P&L per
   contract is positive. If the series tickers for other assets 404, find them via
   `GET /series` and fix `kalshi15m/assets.py`.
3. Sweep `--vol-mult 1.0 1.15 1.3 1.5` and `--min-edge 0.02..0.08` per asset; write
   the winners into `kalshi15m/assets.py` and `PROFILES` in `web/strike-desk.html`.
4. Only then run the live paper loop for BTC and compare its ledger against settlements.

Grades so far (2026-09-25, Crypto.com 5-minute candles, 14 cycles per asset,
accuracy only; see `docs/vixyvault-analysis.md`): BTC B+ (Brier 0.136), SOL B,
XRP B−, ETH C+, NEAR C−, DOGE D+, HYPE F (frozen zero-volume feed; removed).
Profit is ungraded until step 2 runs.

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
