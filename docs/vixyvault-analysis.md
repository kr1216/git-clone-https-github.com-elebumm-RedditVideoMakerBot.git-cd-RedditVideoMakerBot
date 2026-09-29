# VIXY Vault (vixxyvault.com): teardown and how to build it better

Date of analysis: 2026-09-23.

## 0. How this was researched (and what was *not* possible)

| Source | Status |
|---|---|
| `vixxyvault.com`, `cryptonitekin.vercel.app`, `btc-15m-signal.vercel.app` (live fetch) | **Blocked** by this sandbox's egress proxy (HTTP 403 on CONNECT). No HTML/JS bundles could be pulled. |
| Kalshi / Coinbase / Binance APIs (live fetch) | **Blocked** by the same proxy. The code in `kalshi15m/` is written against the documented public APIs but could only be tested offline. |
| Public GitHub repo `onwaterservices-hue/VIXYS-VAULT2` ("the best 15 min prediction bot + 1 hr prediction + scalping") | Found via web search. Attaching/cloning it was **denied** by the session's safety policy (third-party repo), so the code itself was not read. Everything below about internals comes from the **public PR titles/descriptions indexed by search engines**. |
| User screenshots (5) | Used heavily: UI fields, thresholds, and the live numbers shown. |
| Kalshi settlement docs / third-party explainers | Used for market mechanics. |

If you want a deeper, code-level teardown, clone that repo on your own machine
(`git clone https://github.com/onwaterservices-hue/VIXYS-VAULT2`) or allow it in
this environment, and re-run the analysis against the source.

## 1. What it actually is

A **Next.js app on Vercel** with a **server-side "engine" that ticks on a cron**, a
database-backed **ledger** of cycles, and a heavily styled "decision intelligence"
UI. It does **not** place trades. It publishes a directional call (UP/DOWN) for each
Kalshi 15-minute crypto market (mainly `KXBTC15M`), then "locks" the call once enough
checks pass.

### Architecture (reconstructed from PRs)

```
          Coinbase trade WebSocket ──► live spot price, taker buy/sell flow (60s)
          Coinbase Exchange REST ───► fallback BTC price (PR #165)
          Binance WS (price + book) ► order-book / flow inputs (repo description)
          Kalshi REST ─────────────► strike ("price to beat"), YES bid/ask
                     │
                     ▼
   /api/cron/engine-tick  (Vercel cron; CRON_SECRET bearer, PR #246/#92)
   single-flight tick, wedge watchdog >20s, reads wait ≤8s (PR #192)
                     │
                     ▼
   Engine state (in memory + DB ledger, "one row per cycle", PR #215)
   /api/vixy/state · /api/vixy/15m/current · /api/signal
   (tick first if last tick >15s old, PR #162)
   /api/cron/settle (settles the ledger after close, PR #219)
                     │
                     ▼
   UI: Prediction Center, 15-min card, Lock Quality, Reversal Risk,
       "rocket" strike-cross alert, Record/Ledger, Academy, Daily Flip...
```

"Supabase" was not confirmed. The DB vendor is unknown; the ledger and "The Record" are DB-backed.

### The engine's decision logic (as far as it's visible)

1. **Strike acquisition.** It must read a real Kalshi strike before doing anything.
   Placeholder strikes are labelled, and the "Layer-5 rule" and "shadow" only act on a
   Kalshi strike (PRs #56, #165). "Layer-5" implies a multi-layer scoring stack.
2. **Scored signals (0–10 each)**, shown in your screenshot: *Order Flow* (Coinbase
   taker buy % over 60s), *Volume*, *Sentiment* ("Kalshi implied 99¢", so this is
   partly just the Kalshi price), *Volatility* (realized 15m vol, PR #100), plus
   "Spot vs cycle TWAP". These roll into a **composite** ("6.7/10") and "X of N
   signals aligned".
3. **Bias + "chance this wins"** is a lookup against **similar past cycles**
   ("234 past cycles like this", "385 past cycles like this"). The similarity
   buckets are visible in the UI: *minutes into the cycle*, *$ distance from price to
   beat*, and *volatility regime*. So it is essentially **an empirical conditional
   win-rate table**, not a predictive model.
4. **Lock gate: 17 checks.** From screenshot 4:
   - inside the decision window `6:00–13:00` (minutes into the cycle)
   - live price feed healthy `< 10s`
   - signals agree `≥ 8 of 11`
   - price can reach the target (distance vs expected move, "19.6× feasible")
   - signal strength `≥ 66`
   - no signals contradicting
   - safety check approves (`not EXIT/PROTECT`)
   - market not choppy
   - no call made yet this cycle
   - price target confirmed (Kalshi strike read)
   - setup quality `≥ 85` before 8:00 ("Needs 85+ to lock (EARLY)")
   - short and long views agree `≥ 4 of 5`
   - reversal risk `< 30%` and no veto
   - steady for three readings in a row `3/3`
   - signal not flip-flopping
   - data quality `OPTIMAL`
   - direction held long enough `≥ 6s`
5. **Once locked, the call never changes** ("fixed until settlement"). A SKIP is also
   final (PR #209).
6. **Reversal risk / "rocket".** After the lock, a watcher looks up how often
   similar cycles came back. The lock is ruled "lost" only if **≤15% of ≥30 similar
   past cycles** recovered (PR #226). A "rocket" alert fires when live Coinbase price is
   **≥$15 past the strike against the lock** (PR #247). It uses the Coinbase WS because
   **Kalshi's screen lags 5–10s** (PR #221). The strike-side reversal model claims
   *"40% of losses caught at 1.8% false alarms, ~120s warning."*
7. **"Learning · strike-side-v2 · rule on unseen cycles 96.3% (233/242) · refit Mon
   07:30 UTC"** is a weekly refit of the rule table, validated out-of-sample.

## 2. The honest scorecard, from the operator's own PRs

The operator has spent many PRs removing fabricated numbers. That is to their
credit, but it tells you what the product used to claim versus what it measures:

- **"Verified 91.4% signal accuracy over 10,000+ Kalshi settlement blocks"** was
  *invented* and removed (PR #77).
- The "Performance War Room" was reading a **staged** ledger showing "118/136, Brier
  0.052". **Production measured Brier 0.223 over 146 settled locks** (PR #86).
  For reference, always saying 50% gives Brier **0.25**. So 0.223 is only slightly
  better than a coin flip at calibrated probability, and far from the 90%+ implied.
- "52% root cause documented" (PR #37): an earlier engine was running ~52%.
- Other removed items: a "75" default calibration (PR #84), a 0.85 placeholder vol
  (PR #100), "thirteen literal trues" in the gate report (PR #108), a fake proof hash
  (PR #150), invented pattern catalogs (PR #93), staged "BUY UP" drawers (PR #89),
  and unconditional LIVE badges (PR #166).

### Why the "90% today" number is not an edge

Look at your screenshot 5: **VIXY 97% DOWN, "Kalshi prices UP 1% · DOWN 99%",
"VIXY vs market −2.4 pts"**. Screenshot 3: **99% UP with "Kalshi implied 99¢"**.

The engine locks late (6–13 min into the cycle) and needs the price to be clearly on
one side. **By then the Kalshi order book already prices the outcome at 90–99¢.**
A 90% hit rate on contracts bought at 97¢ **loses money**:

```
EV per contract = p_win × (1 − price) − (1 − p_win) × price − fee
               = 0.90 × 0.03 − 0.10 × 0.97 − ~0.01  ≈ −$0.08
```

Break-even win rate = entry price + fee. At 97¢ you need about 98% or better. The "ENGINE
63-7 (90%)" line in your screenshots is **below break-even at those prices**. A
directional call is only worth money when **your probability beats the Kalshi ask
by more than fees**, and the site never shows you that as the headline number.

The clones in your screenshots (`cryptonitekin.vercel.app`,
`btc-15m-signal.vercel.app` "Crypto 15m Trader") follow the same pattern. They show a
"LOCKED DOWN — 77% at lock" plus a "live score" with "Kalshi 0.8% YES". They are the
same product idea: late directional call, Kalshi already agrees.

## 3. The market mechanics that actually matter

- **Series:** `KXBTC15M` (BTC); the other 15-min series follow `KX<ASSET>15M`
  (ETH, SOL, XRP, DOGE, BNB, HYPE, ZEC, NEAR…). Gold, silver, WTI, copper and nat gas 15-min markets
  exist too (your screenshot). Look up their series tickers via
  `GET /series` or the market page URL before configuring them.
- **Question:** will the settlement value be **≥ the strike ("target price")** at
  close? The strike is set at open, from the reference price at the start of the quarter-hour.
- **Settlement:** the **average of the 60 one-second CF Benchmarks RTI prints in the
  final minute**, not the last trade. This matters: the averaging cuts terminal variance
  in the last minute to about a third, and once you're inside the final minute part of
  the answer is already locked in.
- **Latency:** Coinbase/Binance spot leads the Kalshi order book by seconds (the
  operator measured 5–10s). That lag is the only structural edge a retail bot can
  realistically touch.
- **Fees:** taker fee ≈ `ceil(0.07 × C × P × (1−P))` dollars (to the cent). It's
  largest at 50¢ and smallest at the extremes, but it rounds up to 1¢ per order.
  At 97¢ that 1¢ is a third of your upside.

## 4. What to build instead

The replica in `kalshi15m/` skips the similar-cycle lookup tables. It computes
**a fair probability from first principles** and only flags a trade when that
probability beats the live Kalshi price after fees:

1. **Fair value:** P(60s-average ≥ strike), given spot, seconds remaining, realized
   per-second vol, and (in the final minute) the part of the average already observed.
2. **Edge:** `fair − ask − fee` for YES, and `(1 − fair) − no_ask − fee` for NO.
3. **Gate:** feed fresh, strike from Kalshi, vol measured (never a placeholder), edge
   ≥ threshold, time-window bounds, no flip-flopping over N readings.
4. **Ledger:** record fair prob, market price, and outcome. Report **Brier score and PnL
   at the actual entry price**, not a hit rate.

This gives you the same UI-level outputs (bias, confidence, "reversal risk" which is
just `1 − fair` for your side, and distance to strike). It also tells you the one thing
VIXY hides: **whether the call is worth paying for.**

### Tuning ideas once you have a live ledger
- Replace the normal with Student-t tails (the fat tails show up in the last 2–3 minutes).
- Blend vol estimates: 1-min EWMA and 15-min realized.
- Add order-flow imbalance as a drift term only after you've shown it improves Brier
  out-of-sample.
- Measure the Coinbase→Kalshi lag yourself. If the book reliably trails spot by
  ≥3s, the quote-staleness edge is where the money is, not in the direction call.

## 5. Replay results (2026-09-25)

Crypto.com 5-minute candles, 13:00–16:15 UTC, 14 cycles per asset, a call at
10 and 5 minutes left, volatility from the preceding hour only. Accuracy only:
Kalshi's quoted prices were not available, so profit is not graded.

| Asset | Brier | Right side | Grade |
|---|---|---|---|
| BTC | 0.136 | 82% | B+ |
| SOL | 0.179 | 79% | B |
| XRP | 0.175 | 79% | B− |
| ETH | 0.188 | 75% | C+ |
| NEAR | 0.227 | 61% | C− |
| DOGE | 0.237 | 64% | D+ |
| HYPE | 0.250 | 64% | F (feed has zero-volume, frozen candles) |

At 1.15× volatility the 80–95% calls averaged 87% confidence but were right 69%
of the time (n=35); at 1.5× they were right 85%. Hence the per-asset defaults in
`kalshi15m/assets.py`: BTC 1.15×, others 1.5×, and a higher minimum edge for the
thinly traded DOGE and NEAR. `python -m kalshi15m.backtest` replaces this with
Kalshi's own prices and settlements.

## 6. Kalshi backtest: profit after fees on real prices (2026-09-25)

`python -m kalshi15m.backtest` on Kalshi's settled 15-minute markets from
2026-09-15 to 09-25: real strikes, real results, Kalshi's 1-minute Yes bid/ask,
Coinbase 1-minute spot. One contract per market, taken at the first minute (2–14)
where the engine says BUY, at the quoted ask plus Kalshi's taker fee.

**Method.** For each asset, every vol_mult (1.0, 1.15, 1.3, 1.5) × min_edge
(2–8¢) pair was graded on the older 150 of the latest 300 markets and then on the
newer 150 (held out). A pair counts only if it made money on both halves. Pairs
that passed were rerun on 1000 markets, and the 700 older markets that played no
part in choosing them are reported separately as the unseen test.

| Asset | Setting | Markets | Trades | Win rate | P&L per contract | Brier model vs Kalshi mid | Verdict |
|---|---|---|---|---|---|---|---|
| SOL | 1.0×, 4¢ | 999 | 684 | 43% | **+3.8¢** (unseen 700: +3.4¢ ± 1.9, 502 trades) | 0.135 vs 0.137 | edge |
| NEAR | 1.0×, 7¢ | 1000 | 498 | 34% | **+3.2¢** (unseen 700: +2.4¢ ± 2.2, 360 trades) | 0.135 vs 0.137 | weak |
| DOGE | 1.5×, 8¢ | 999 | 893 | 23% | −0.5¢ | 0.140 vs 0.133 | none |
| ETH | 1.5×, 4¢ | 300 | 286 | 26% | −1.4¢ | 0.143 vs 0.136 | none |
| BTC | 1.15×, 3¢ | 300 | 218 | 30% | −5.5¢ | 0.139 vs 0.142 | none |
| XRP | 1.5×, 3¢ | 300 | 298 | 23% | −5.6¢ | 0.137 vs 0.130 | none |

± is one standard error. "none" rows show the old default; no pair held up.
For BTC and XRP none of the 28 pairs made money on the held-out half (best:
BTC −3.4¢, XRP −3.0¢). ETH's best held-out was +0.1¢, losing in-sample. DOGE's
one passing pair (1.5×, 8¢) was break-even over 1000 markets.

**What went wrong on BTC.** Kalshi's BTC book is the best-priced of the six.
The model's trades were mostly long shots: under 25¢ it said 22%, Kalshi said
16%, and they won 8% (n=83). The BTC sweep also shows the overfitting trap:
the best in-sample pair (+3.4¢) lost 12¢ per contract on the held-out half.

**Caveats.** Fills assume the ask at a minute's close could be taken in full,
with no latency or depth limit, so real results will be somewhat worse.
Coinbase stands in for the CF Benchmarks index (at the open it sat within ±$25
of BTC's strike, median $1). Ten days of data is one market regime. SOL's
unseen result is about 1.8 standard errors from zero and NEAR's about 1.1.
Neither is proven; the live paper loop is the next test.

**Update 2026-09-26.** docs/model-research.md replaced these settings: the engine
now trades on a blend of the model with Kalshi's mid, volatility is 0.9× (BTC
1.15×, NEAR 1.0×) and the minimum edge is 3¢. Held out, SOL, NEAR and DOGE made
money; XRP, ETH and BTC did not.

### Live paper results

`python -m kalshi15m` in a cloud session from 2026-09-25 18:37 UTC, scored with
`python -m kalshi15m.score` (first BUY per market at the ask seen, plus fee).
Rows up to 2026-09-26 02:40 are the pre-blend model (SOL 1.0×/4¢, NEAR 1.0×/7¢,
2s polls, 3 stable readings). Later rows say which model.

| As of (UTC) | Asset | Settled markets | Trades | Win rate | P&L per contract | Brier model vs Kalshi mid |
|---|---|---|---|---|---|---|
| 2026-09-25 20:39 | SOL | 8 | 8 | 62% | +16.4¢ | 0.109 vs 0.125 |
| 2026-09-25 20:39 | NEAR | 8 | 7 | 43% | +1.3¢ | 0.165 vs 0.186 |
| 2026-09-26 02:40 | SOL | 32 | 32 | 59% | +12.2¢ | 0.153 vs 0.167 |
| 2026-09-26 02:40 | NEAR | 32 | 30 | 50% | +3.5¢ | 0.159 vs 0.175 |
| 2026-09-26 08:42 | SOL pre-blend | 56 | 56 | 59% | +8.2¢ | 0.156 vs 0.163 |
| 2026-09-26 08:42 | NEAR pre-blend | 56 | 54 | 57% | +9.3¢ | 0.158 vs 0.168 |
| 2026-09-26 08:42 | SOL blend | 16 | 16 | 69% | +11.3¢ | 0.174 vs 0.169 |
| 2026-09-26 08:42 | NEAR blend | 16 | 16 | 62% | +13.5¢ | 0.145 vs 0.147 |
| 2026-09-26 08:42 | DOGE blend | 16 | 15 | 53% | −3.4¢ | 0.145 vs 0.146 |
| 2026-09-26 14:44 | SOL pre-blend | 81 | 81 | 58% | +5.9¢ | 0.151 vs 0.159 |
| 2026-09-26 14:44 | NEAR pre-blend | 81 | 79 | 49% | +1.4¢ | 0.158 vs 0.163 |
| 2026-09-26 14:44 | SOL blend | 41 | 41 | 56% | −0.6¢ | 0.157 vs 0.157 |
| 2026-09-26 14:44 | NEAR blend | 41 | 41 | 46% | −2.3¢ | 0.152 vs 0.151 |
| 2026-09-26 14:44 | DOGE blend | 41 | 39 | 56% | −0.9¢ | 0.139 vs 0.143 |
| 2026-09-26 15:25 | SOL pre-blend | 83 | 83 | 57% | +4.2¢ | 0.151 vs 0.159 |
| 2026-09-26 15:25 | NEAR pre-blend | 83 | 81 | 49% | +0.9¢ | 0.159 vs 0.165 |
| 2026-09-26 15:25 | SOL blend | 43 | 43 | 53% | −3.5¢ | 0.158 vs 0.158 |
| 2026-09-26 15:25 | NEAR blend | 43 | 43 | 47% | −2.7¢ | 0.154 vs 0.155 |
| 2026-09-26 15:25 | DOGE blend | 43 | 41 | 59% | +1.6¢ | 0.138 vs 0.142 |
| 2026-09-26 20:47 | SOL pre-blend | 105 | 105 | 56% | +4.2¢ | 0.144 vs 0.155 |
| 2026-09-26 20:47 | NEAR pre-blend | 105 | 102 | 52% | +3.9¢ | 0.157 vs 0.164 |
| 2026-09-26 20:47 | SOL blend, order book | 21 | 20 | 60% | +3.0¢ | 0.135 vs 0.139 |
| 2026-09-26 20:47 | NEAR blend, order book | 21 | 14 | 57% | +6.2¢ | 0.158 vs 0.153 |
| 2026-09-27 02:59 | SOL pre-blend | 129 | 129 | 55% | +3.7¢ | 0.138 vs 0.148 |
| 2026-09-27 02:59 | NEAR pre-blend | 129 | 126 | 51% | +3.7¢ | 0.149 vs 0.154 |
| 2026-09-27 02:59 | SOL blend, order book | 45 | 41 | 56% | +0.6¢ | 0.125 vs 0.126 |
| 2026-09-27 02:59 | NEAR blend, order book | 45 | 34 | 47% | −1.0¢ | 0.134 vs 0.130 |
| 2026-09-27 09:02 | SOL pre-blend | 154 | 154 | 56% | +4.2¢ | 0.137 vs 0.146 |
| 2026-09-27 09:02 | NEAR pre-blend | 154 | 151 | 51% | +3.6¢ | 0.149 vs 0.158 |
| 2026-09-27 09:02 | SOL blend, order book | 70 | 64 | 56% | −0.1¢ | 0.127 vs 0.126 |
| 2026-09-27 09:02 | NEAR blend, order book | 70 | 53 | 51% | +2.1¢ | 0.149 vs 0.149 |
| 2026-09-27 15:06 | SOL pre-blend (snapshot prices, see below) | 178 | 178 | 56% | +4.4¢ | 0.139 vs 0.149 |
| 2026-09-27 15:06 | NEAR pre-blend (snapshot prices, see below) | 178 | 174 | 53% | +5.7¢ | 0.144 vs 0.155 |
| 2026-09-27 15:06 | SOL blend, order book | 94 | 85 | 56% | +1.6¢ | 0.137 vs 0.136 |
| 2026-09-27 15:06 | NEAR blend, order book | 94 | 76 | 49% | +0.5¢ | 0.146 vs 0.145 |
| 2026-09-27 21:14 | SOL blend, order book | 118 | 109 | 56% | +2.6¢ | 0.144 vs 0.143 |
| 2026-09-27 21:14 | NEAR blend, order book | 118 | 96 | 46% | −0.9¢ | 0.147 vs 0.146 |
| 2026-09-27 21:14 | SOL model only, order book | 25 | 24 | 50% | +9.0¢ | 0.154 vs 0.169 |
| 2026-09-27 21:14 | NEAR model only, order book | 24 | 22 | 23% | −12.3¢ | 0.152 vs 0.151 |
| 2026-09-28 03:18 | SOL blend, order book | 143 | 127 | 53% | −0.3¢ | 0.138 vs 0.136 |
| 2026-09-28 03:18 | NEAR blend, order book | 143 | 120 | 43% | −3.4¢ | 0.152 vs 0.149 |
| 2026-09-28 03:18 | SOL model only, order book | 49 | 46 | 39% | −4.9¢ | 0.129 vs 0.137 |
| 2026-09-28 03:18 | NEAR model only, order book | 49 | 44 | 25% | −13.9¢ | 0.160 vs 0.158 |
| 2026-09-28 09:23 | SOL blend, order book | 167 | 146 | 53% | −1.2¢ | 0.142 vs 0.141 |
| 2026-09-28 09:23 | NEAR blend, order book | 167 | 140 | 46% | −1.8¢ | 0.155 vs 0.154 |
| 2026-09-28 09:23 | SOL model only, order book | 73 | 70 | 41% | −4.3¢ | 0.139 vs 0.147 |
| 2026-09-28 09:23 | NEAR model only, order book | 73 | 66 | 32% | −7.8¢ | 0.160 vs 0.165 |
| 2026-09-29 00:16 | SOL blend, order book | 227 | 196 | 51% | −2.6¢ | 0.152 vs 0.151 |
| 2026-09-29 00:16 | NEAR blend, order book | 227 | 183 | 45% | +0.2¢ | 0.165 vs 0.165 |
| 2026-09-29 00:16 | SOL model only, order book | 133 | 126 | 43% | −2.6¢ | 0.152 vs 0.162 |
| 2026-09-29 00:16 | NEAR model only, order book | 133 | 116 | 34% | −6.4¢ | 0.169 vs 0.180 |
| 2026-09-29 13:13 | SOL blend, order book | 278 | 237 | 52% | −1.7¢ | 0.150 vs 0.149 |
| 2026-09-29 13:13 | NEAR blend, order book | 279 | 227 | 44% | +1.3¢ | 0.161 vs 0.161 |
| 2026-09-29 13:13 | SOL model only, order book | 185 | 177 | 44% | −0.7¢ | 0.145 vs 0.155 |
| 2026-09-29 13:13 | NEAR model only, order book | 185 | 162 | 36% | −3.3¢ | 0.160 vs 0.170 |

Blend loops started 2026-09-26 04:31 UTC. On the same 16 markets the pre-blend model made
+6.7¢ (SOL) and +17.0¢ (NEAR) per contract. The container restarted at ~07:29 UTC on
09-26; all loops were back within a minute (pre-blend with its original settings).
Same 41 markets at 14:44: pre-blend SOL +3.0¢ vs blend −0.6¢; NEAR −2.9¢ vs −2.3¢.
Live loops trade far more often than the backtest: the blend traded 41 of 41 SOL markets
(36 even if checked once a minute), against 42% of markets in the backtest. Cause not yet
known (candidates: weekend quote staleness on Kalshi, or live REST quotes differing from
1-minute candle closes).
Live quotes vs the backtest's candle closes differ by ~4.4¢ on average (docs/model-research.md, last section).
Order-book blend loops started ~15:55 UTC 09-26 (the snapshot-price blend loops were stopped). Same 21
markets at 20:47: baseline SOL +2.8¢ vs order-book blend +3.0¢; NEAR +13.8¢ vs +6.2¢. Container
restarted ~20:27 UTC; loops back within a minute.
Same ~46 markets at 09-27 02:59: baseline SOL +0.8¢ vs order-book blend +0.9¢; NEAR +9.1¢ vs +0.8¢.
Same 70 markets at 09-27 09:02: baseline SOL +3.9¢ vs order-book blend −0.1¢; NEAR +6.1¢ vs +2.1¢.
**The pre-blend loops' profit was a pricing artifact (checked 2026-09-27 15:06).** They filled at
Kalshi's market-listing prices, which lag the order book. Re-pricing each of their 184 trades
(since the order-book loops started) at the order-book ask logged within 2 seconds by the
order-book loops: SOL +4.8¢ → −2.9¢, NEAR +8.7¢ → +0.3¢, pooled +6.7¢ → −1.3¢ (±3.4). When the
model chose to buy, the real ask was on average ~8¢ above the listing price: it bought exactly
when the listing was stale. Every pre-blend row above overstates what was tradable. The
pre-blend loops were stopped and replaced by the same model on order-book prices
(`ledger-{sol,near}-ob-model.jsonl`, 1.0× vol, 4¢/7¢ edge, 1s polls) from 15:10 UTC.
Order-book blend pooled at 09-27 21:14: +0.9¢ ±2.8 over 207 trades. Same 25 markets since 15:10:
SOL model-only +9.0¢ vs blend +6.9¢; NEAR −14.0¢ vs −8.2¢.
At 09-28 03:18, pooled at order-book prices: blend −1.8¢ ±2.6 (247 trades), model only −9.3¢ ±4.5
(90 trades, about 2 standard errors below zero). Container restarted ~22:22 UTC 09-27; loops back within a minute.
At 09-28 09:23, pooled at order-book prices: blend −1.5¢ ±2.5 (286 trades), model only −6.0¢ ±3.8 (136).
At 09-29 00:16, pooled at order-book prices: blend −1.3¢ ±2.2 (379 trades), model only −4.4¢ ±2.9 (242).
The 09-28 15:28 check-in could not run commands (auto-mode check outage); container restarted 09-28 ~11:19
and 09-29 ~00:16 UTC, loops back within a minute each time.
At 09-29 13:13, pooled at order-book prices: blend −0.2¢ ±2.0 (465 trades), model only −1.9¢ (339 trades).
The 09-29 06:23 check-in could not run commands (auto-mode check outage); container restarted ~13:12 UTC 09-29.
NEAR's Coinbase feed goes quiet for over 5 seconds on about 19% of ticks, and the loop skips those.
Eight or thirty markets is far too few to judge: one trade swings P&L by ±50¢. Compare against
the backtest only after a few hundred trades.

## Sources

- https://github.com/onwaterservices-hue/VIXYS-VAULT2 (repo description)
- PRs #37, #56, #74, #77, #80, #84, #86, #89, #92, #93, #100, #108, #150, #151, #162,
  #165, #166, #169, #192, #203, #209, #212, #215, #219, #221, #226, #228, #246, #247, #248
  at https://github.com/onwaterservices-hue/VIXYS-VAULT2/pulls
- https://help.kalshi.com/en/articles/13823838-crypto-markets
- https://predictionmarketspicks.com/articles/how-kalshi-settles-bitcoin
- https://kalshibacktest.com/resources/kalshi-btc-15-minute-markets
- https://www.tiktok.com/@vixyvault/video/7677245689490984223
