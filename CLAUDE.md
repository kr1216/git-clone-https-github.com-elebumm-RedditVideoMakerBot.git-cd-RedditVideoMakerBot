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
  - `engine.py`: decision gate (edge after fees, time window, staleness, `vol_mult`), and the
    blend of the model with Kalshi's mid (`Config.blend`) that the engine trades on.
  - `assets.py`: per-asset series, Coinbase product, volatility multiplier, minimum edge,
    backtest verdict (`edge` / `weak` / `none`) and blend weights.
  - `feeds.py`: Kalshi REST (current market) and Coinbase WebSocket spot.
  - `__main__.py`: live paper loop, `python -m kalshi15m --series KXSOL15M --ledger ledger-sol-blend.jsonl`
    (1s polls, acts on the first qualifying reading; `--no-blend` for the model alone).
    Volatility comes from Coinbase 1-minute closes over 30 minutes, the backtest's estimator.
  - `score.py`: scores a ledger against Kalshi settlements (first BUY per market, P&L after
    fees, model vs Kalshi-mid Brier). `python -m kalshi15m.score ledger-sol.jsonl`.
  - `backtest.py`: replays Kalshi's settled markets with Kalshi's real 1-minute
    Yes bid/ask and Coinbase 1-minute spot; reports P&L per contract and model
    Brier vs Kalshi-mid Brier. `python -m kalshi15m.backtest --series KXBTC15M --markets 300`;
    add `--sweep` to grade every vol_mult x min_edge pair on the older half and the held-out
    newer half. Downloads are cached in `.cache/kalshi15m/` (gitignored).
- `research/`: model-improvement experiments on the backtest cache (`features.py` rows per
  market-minute, `evaluate.py` scoring, `experiments.py`, `timing.py`, `proxy_error.py`).
  Run with `PYTHONPATH=. python -m research.experiments SOL`. Findings: `docs/model-research.md`.
- `web/strike-desk.html`: source of the mobile "Strike Desk" claude.ai artifact
  (https://claude.ai/artifact/89KZ3DTCWGimbqxXQuHTUx). Same math in JS; live spot via
  the Crypto.com connector, manual Kalshi inputs, journal in the artifact db,
  per-asset defaults in `PROFILES` (keep in sync with `kalshi15m/assets.py`).
- `tests/`: offline unit tests. Install: `pip install -r requirements.txt`.
  Test: `python -m pytest -q tests`.

## Kalshi runbook

Kalshi market data is public: no API key is needed. Check access first:
`curl -s -o /dev/null -w "%{http_code}\n" https://api.elections.kalshi.com/trade-api/v2/exchange/status`
must print 200 (000 means the environment's network policy blocks it; Coinbase needs
`api.exchange.coinbase.com` allowed too).

Done 2026-09-25 (steps 1-3 below). Results are in `docs/vixyvault-analysis.md` section 6.

1. `pip install -r requirements.txt && python -m pytest -q tests`
2. `python -m kalshi15m.backtest --series <SERIES> --markets 300 --sweep`, then confirm any
   pair that makes money on both halves with `--markets 1000 --vol-mult X --min-edge Y`.
   The model has an edge only if its Brier is below Kalshi-mid Brier AND P&L per contract
   is positive on markets not used to choose the setting.
3. Write winners and verdicts into `kalshi15m/assets.py` and `PROFILES` in `web/strike-desk.html`.
4. Run the live paper loop and score it:
   `python -m kalshi15m --series KXSOL15M --ledger ledger-sol-blend.jsonl`, then
   `python -m kalshi15m.score ledger-sol-blend.jsonl`. `ledger-sol.jsonl` / `ledger-near.jsonl`
   are the pre-blend model (started 2026-09-25 18:37 UTC); `*-blend.jsonl` the blend (09-26). Ledgers and logs are gitignored; record
   scored results in `docs/vixyvault-analysis.md`. Re-run the backtest monthly.
   Started 2026-09-25 in a cloud session (ends when that container is reclaimed).

Grades (held-out newer 500 of 1000 markets, blend at a 3c minimum edge; docs/model-research.md):
SOL edge (+3.6c/contract ±2.4), NEAR weak (+4.8c ±3.6), DOGE weak (+5.1c ±3.0), XRP none
(−0.2c), ETH none, BTC none (Kalshi's own price is more accurate than the model). The
pre-blend model: SOL +3.4c on 700 unseen markets, NEAR +2.4c, others lost money.
Live paper results so far: docs/vixyvault-analysis.md, "Live paper results".

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
