# Model research: what improves the Kalshi 15-minute fair-value model (2026-09-25)

Data: Kalshi's last 1000 settled 15-minute markets per asset (2026-09-15 to 09-25),
Kalshi's 1-minute Yes bid/ask, Coinbase 1-minute closes, and Kalshi's official
settlement values. About 12,800 market-minutes per asset.

Method: every parameter (volatility multiplier, lookback, basis noise, blend
weights) was fitted on the **older 500 markets** and graded on the **newer 500**.
The main grade is held-out log loss and Brier (accuracy), which is much less
noisy than P&L. P&L uses the backtest's rule (first minute with edge ≥ threshold,
pay the ask plus Kalshi's taker fee) at fixed 3¢ and 6¢ thresholds, so no
threshold is cherry-picked. ± is one standard error.

Reproduce: `python -m kalshi15m.backtest --series <SERIES> --markets 1000` to fill
the cache, then `PYTHONPATH=. python -m research.experiments BTC ETH SOL XRP DOGE NEAR`,
`python -m research.timing`, `python -m research.proxy_error`.

## Headline

1. **Kalshi's price is already about as accurate as the model.** Held-out log loss,
   model (best volatility) vs Kalshi mid: BTC 0.438 vs 0.428, ETH 0.437 vs 0.431,
   XRP 0.403 vs 0.400, DOGE 0.407 vs 0.405, SOL 0.415 vs 0.416, NEAR 0.412 vs 0.412.
   The model only matches the market; it does not beat it on its own.
2. **Blending the model with Kalshi's price is the one change that helps
   everywhere it can.** `logit p = a·logit(model) + b·logit(Kalshi mid) + c`, fitted
   in-sample, beats the market on held-out accuracy for SOL, NEAR, DOGE and XRP,
   and trades far less, only when the two disagree strongly.
3. **Volatility was mis-set for four assets.** ETH, XRP and DOGE were at 1.5× and
   SOL at 1.0×; the accuracy-fitted value is 0.9× for all four (BTC stays 1.15×).
   ETH/XRP/DOGE log loss improves by 0.016–0.026, the largest single accuracy gain.
4. **Speed matters.** Filling one minute after the signal costs 2–7¢ per contract,
   so part of the edge is catching Kalshi quotes before they move.
5. **BTC and ETH have no edge under any variant.** Every model and blend loses on
   held-out BTC and ETH markets.

## Results per asset (held-out 500 markets)

| Asset | Kalshi mid log loss | Best model alone | Blend (a, b) | Blend log loss | Blend P&L @3¢ | Blend P&L @6¢ |
|---|---|---|---|---|---|---|
| SOL | 0.4159 | 0.4154 (0.9×) | 0.79, 0.25 | **0.4141** | +4.0¢ ±2.4 (277) | +3.2¢ ±3.8 (119) |
| NEAR | 0.4115 | 0.4120 (1.0×) | 0.53, 0.50 | **0.4078** | +5.4¢ ±3.9 (129) | −0.8¢ ±7.6 (36) |
| DOGE | 0.4051 | 0.4065 (0.9×) | 0.48, 0.60 | **0.4044** | +4.4¢ ±3.5 (179) | +10.9¢ ±6.2 (60) |
| XRP | 0.3999 | 0.4029 (0.9×) | 0.58, 0.49 | **0.3985** | −0.2¢ ±2.9 (171) | −2.3¢ ±6.7 (35) |
| ETH | **0.4306** | 0.4367 (0.9×) | 0.34, 0.78 | 0.4364 | −5.1¢ ±3.1 (211) | −0.5¢ ±8.0 (30) |
| BTC | **0.4278** | 0.4377 (1.15×) | 0.40, 0.61 | 0.4309 | −5.5¢ ±3.8 (102) | −11.8¢ ±6.9 (32) |

Trade counts in brackets. For comparison, today's production settings on the
same held-out markets: SOL +1.0¢ @3¢ / +4.5¢ @6¢, NEAR +0.7¢ / +2.1¢, DOGE
(1.5×) −1.4¢ / −2.1¢, XRP (1.5×) −5.6¢ / −4.2¢, ETH (1.5×) −0.1¢ / −2.2¢,
BTC −4.9¢ / −7.3¢.

DOGE is worth noting: it was graded "none" and was not used to choose the blend
idea, so its held-out gain from the blend (−1.4¢ to +4.4¢ at 3¢) is the least
selection-biased evidence here. Still, each asset's gain is within about 1–2
standard errors; pooled over SOL, NEAR and DOGE the blend makes about +4.5¢ on
~585 held-out trades (≈2.5 standard errors).

## What did not help

| Idea | Result |
|---|---|
| Shift spot by the Coinbase-vs-index gap measured at the open | Worse held-out log loss on all 6 assets. The gap at the open does not persist. |
| Add that gap's uncertainty to the variance | No accuracy gain once volatility is right. |
| Volatility lookback 10/15/60 min instead of 30 | 30 min was best or tied everywhere except DOGE (60) and BTC/ETH (15), which did worse held-out. |
| Momentum (last 5 minutes) as a feature | Coefficient ≈ 0; no held-out gain. |
| Skip long shots (price < 10/20/30¢) after blending | No consistent gain; the blend already avoids most long shots. |

## Where the remaining error comes from

**Coinbase is not the index Kalshi settles on.** Against Kalshi's published
settlement values, the Coinbase 1-minute proxy for the final-minute average is off
by 1 sd = $12.8 (BTC), $0.59 (ETH), $0.029 (SOL), $0.00053 (XRP), $0.000035 (DOGE),
$0.0032 (NEAR), and picks the wrong side of the strike in **2.3–3.2% of markets**.
The live loop's 1-second Coinbase data should do somewhat better than this
1-minute proxy, but a single exchange cannot remove it.

**Fill timing.** Held-out, deciding at minute m but paying minute m+1's ask:

| Asset (blend) | Fill now @3¢ | Fill 1 minute later @3¢ |
|---|---|---|
| SOL | +3.6¢ ±2.4 | +1.9¢ ±2.4 |
| NEAR | +4.8¢ ±3.6 | +1.1¢ ±3.5 |
| DOGE | +5.1¢ ±3.0 | −1.9¢ ±2.9 |

The backtest fills at the minute-close ask with no depth limit; that is optimistic.

## Recommendations, in order

1. **Use the blend as the probability the engine trades on**, with per-asset
   weights refitted monthly, and volatility at 0.9× (BTC 1.15×). Trade only where
   the blend beat Kalshi held-out: SOL, NEAR, DOGE (XRP is break-even). Keep BTC and
   ETH off. Run it in the paper loop next to the current model before trusting it.
2. **Be fast.** Poll Kalshi every 1s instead of 2s, act on the first qualifying
   reading (the backtest's `stable_readings=1` is what was measured; live uses 3),
   and log the ask actually seen so live results can be compared with the delay
   test above.
3. **Replicate the index better.** CF Benchmarks' real-time indices average several
   exchanges (Coinbase, Kraken, Bitstamp, Gemini, LMAX and others). Averaging two or
   three of their public feeds should cut the 2–3% wrong-side rate. Untested here:
   it needs those exchanges' 1-minute history.
4. **Measure, do not assume, the execution cost.** Fills at the quoted ask with no
   size limit are the biggest optimistic assumption. Kalshi's public trade history
   (`GET /markets/trades`) can show whether the ask traded at size in those minutes.
5. **More regimes.** Ten days is one market regime. Re-run the backtest monthly and
   keep an asset only while its held-out P&L stays positive.

## Update 2026-09-26: the backtest's prices do not match live quotes

`research/live_vs_candles.py` compared the paper loops' live Kalshi quotes (last
reading in the final 5 seconds of each minute) with the 1-minute candlestick
closes the backtest fills at, for the same settled markets. SOL: 515 minute marks,
mean absolute gap 4.4c on both bid and ask, exact match 7%; DOGE: 505 marks,
4.5c, 10%. The gap averages about zero, so it is noise rather than bias, but it is
larger than the 3-5c edges the backtest found. A spot check showed the live market
snapshot within 0.1-0.3c of the order book (near expiry only), so the mismatch most
likely sits in the candle data. Until fills are checked against Kalshi's trade
history (`GET /markets/trades`), treat every backtest P&L figure here as unconfirmed.

## Update 2026-09-26: tested on Kalshi's real trades, the edge is speed

`research/trades.py` downloaded every executed trade for the latest 300 settled
markets per coin (NEAR 279k trades, SOL 758k, DOGE). `research/trade_backtest.py`
replays the model against them: at each real trade 2-14 minutes into the cycle,
the model prices the market from Coinbase 1-minute closes that finished before the
trade; if buying the side the taker bought, at that price, clears the edge after
fees, that trade is our fill (someone really bought there). One fill per market.

Blend, 3c minimum edge, by how old the Coinbase price was at the trade:

| Coin | spot ≤ 60s old | ≤ 10s | ≤ 3s | same ≤ 3s trades, spot 1 min older (control) |
|---|---|---|---|---|
| SOL | −2.5c ±2.7 (297) | +1.6c ±2.8 (259) | **+6.6c ±3.2 (176)**; older +6.7c, newer +6.6c | −3.9c ±2.6 (296) |
| NEAR | −4.5c ±2.7 (284) | +3.2c ±3.1 (198) | **+7.1c ±4.1 (113)**; older +2.6c, newer +11.6c | −2.1c ±2.7 (252) |
| DOGE | −3.2c ±2.8 (277) | −4.7c ±3.3 (181) | −4.1c ±4.6 (108) | +0.9c ±2.9 (248) |

The control rules out a timing effect: on the very same trades, a one-minute-older
price loses. SOL and NEAR together: about +6.8c per contract, ≈2.7 standard errors.
DOGE shows no edge at any freshness and is now graded "none".

Other findings from the trade data:
* Takers lose roughly Kalshi's fee on average at every price and time (NEAR grid:
  mostly −2 to −6c). Makers earn about zero before fees (NEAR +0.1c ±0.2). Kalshi's
  prices are fair on average; there is no static price/time bias to harvest.
* The market listing's yes_ask/no_ask lags the order book by up to 5c mid-cycle.
  The live loop now reads `/markets/{ticker}/orderbook` (`--snapshot-quotes` for
  the old behavior).

What this means for trading: the edge exists only for a bot that reacts to Coinbase
within seconds and reads Kalshi's live order book. Manual trading from the Strike
Desk cannot capture it. BTC, ETH and XRP trade data were still downloading.
