"""Backtest the model against real Kalshi trades instead of 1-minute candle quotes.

For every executed trade in the engine's window (2 to 14 minutes into the cycle),
the model prices the market using only Coinbase 1-minute closes that had finished
before the trade (no look-ahead; spot can be up to a minute old). If buying the
side that taker bought, at that trade's price, clears the minimum edge after fees,
we count it as our fill: someone really did buy that side at that price then.
First such fill per market; each market trades at most once.

    PYTHONPATH=. python -m research.trade_backtest KXSOL15M KXNEAR15M ...
"""

from __future__ import annotations

import math
import statistics as st
import sys

from kalshi15m.assets import for_series
from kalshi15m.backtest import CYCLE_S, load_dataset
from kalshi15m.model import blend_with_market, kalshi_fee

from .evaluate import gbm_prob
from .features import vol_at
from .trades import load_trades


def run(series: str, vm: float, min_edge: float, blend=None, lookback: int = 30, max_price: float = 0.92,
        max_stale: float = 60.0, lag_minutes: int = 0):
    """max_stale: only fill on trades at most this many seconds after the spot minute closed.
    lag_minutes: control; price with spot that many minutes older (same trades, staler information)."""
    data = load_trades(series)
    _, _, spot = load_dataset(series, 1000)
    pnls, closes = [], []
    for t, m in data.items():
        close, strike, outcome = m["close"], m["strike"], m["outcome"]
        for ts, yes_price, taker_yes, count in m["trades"]:
            into = ts - (close - CYCLE_S)
            if not (120 <= into <= 14 * 60):
                continue
            end = int(ts // 60) * 60  # last completed minute: known before the trade
            if ts - end > max_stale:
                continue
            px, v = spot.get(end - 60 * lag_minutes), vol_at(spot, end - 60 * lag_minutes, lookback)
            if px is None or not v:
                continue
            p_up = gbm_prob(px, strike, close - ts, v * vm)
            if blend:
                p_up = blend_with_market(p_up, yes_price, blend)  # the trade price stands in for Kalshi's mid
            price = yes_price if taker_yes else 1 - yes_price
            p_win = p_up if taker_yes else 1 - p_up
            if not (0 < price <= max_price):
                continue
            if p_win - price - kalshi_fee(price) >= min_edge:
                won = outcome if taker_yes else 1 - outcome
                pnls.append(won - price - kalshi_fee(price))
                closes.append(close)
                break
    return pnls, closes


def stats(p):
    if len(p) < 2:
        return f"{len(p):4d} tr"
    return f"{len(p):4d} tr  win {sum(x > 0 for x in p)/len(p):3.0%}  {100*st.mean(p):+5.1f}¢ ±{100*st.stdev(p)/math.sqrt(len(p)):.1f}"


def main(series_list, stale=(60.0, 10.0, 3.0)):
    for s in series_list:
        prof = for_series(s)
        print(f"\n{s} on real trades ({len(load_trades(s))} markets):")
        for label, vm, blend in (("model", prof.vol_mult, None), ("blend", prof.vol_mult, prof.blend)):
          for ms in stale:
            for e in (0.03, 0.06):
                p, c = run(s, vm, e, blend, max_stale=ms)
                cut = sorted(c)[len(c) // 2] if c else 0
                old = [x for x, cc in zip(p, c) if cc < cut]
                new = [x for x, cc in zip(p, c) if cc >= cut]
                print(f"  {label:5s} spot<={ms:2.0f}s old, edge {e*100:2.0f}c: all {stats(p)} | older {stats(old)} | newer {stats(new)}")





def control(series_list):
    """Same fresh-window trades, priced with fresh vs one-minute-older spot."""
    for s in series_list:
        prof = for_series(s)
        for lag in (0, 1):
            for e in (0.03, 0.06):
                p, _ = run(s, prof.vol_mult, e, prof.blend, max_stale=3.0, lag_minutes=lag)
                print(f"  {s} blend, trades <=3s after the minute, spot {'fresh' if lag == 0 else '1 min older'}, edge {e*100:.0f}c: {stats(p)}")


if __name__ == "__main__":
    if sys.argv[1] == "control":
        control(sys.argv[2:])
    else:
        main(sys.argv[1:])
