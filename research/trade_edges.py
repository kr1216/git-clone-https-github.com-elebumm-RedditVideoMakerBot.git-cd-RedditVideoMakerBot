"""Where do Kalshi 15-minute contracts win more often than their price says?

Uses real executed trades (research/trades.py). For every trade, the taker bought
one side at a known price; after settlement we know whether that side won. Grouped
by price paid and minutes left, this shows what a buyer at that price and time
actually earned after Kalshi's taker fee, with no model involved.

Each market counts once per bucket (its trades' average), so busy markets don't
dominate and standard errors are across markets. Buckets are graded on the older
half of the markets and checked on the newer half.

    PYTHONPATH=. python -m research.trade_edges KXSOL15M KXNEAR15M ...
"""

from __future__ import annotations

import math
import statistics as st
import sys
from collections import defaultdict

from kalshi15m.model import kalshi_fee

from .trades import load_trades

PRICE_BINS = [(0.0, 0.10), (0.10, 0.25), (0.25, 0.40), (0.40, 0.60), (0.60, 0.75), (0.75, 0.90), (0.90, 0.97), (0.97, 1.0)]
TIME_BINS = [(10, 13), (5, 10), (2, 5), (0.33, 2)]  # minutes left, inside the engine's window


def bucket(x, bins):
    for lo, hi in bins:
        if lo <= x < hi:
            return (lo, hi)
    return None


def market_rows(data: dict) -> list[tuple[int, str, tuple, tuple, float, float]]:
    """(close, ticker, price_bin, time_bin, mean taker P&L after fee, mean win) per market and bucket."""
    out = []
    for t, m in data.items():
        acc = defaultdict(list)
        for ts, yes_price, taker_yes, count in m["trades"]:
            mins = (m["close"] - ts) / 60
            price = yes_price if taker_yes else 1 - yes_price
            if not 0 < price < 1:
                continue
            won = m["outcome"] if taker_yes else 1 - m["outcome"]
            pb, tb = bucket(price, PRICE_BINS), bucket(mins, TIME_BINS)
            if pb and tb:
                acc[(pb, tb)].append((won - price - kalshi_fee(price), won, price))
        for (pb, tb), xs in acc.items():
            out.append((m["close"], t, pb, tb, st.mean(x[0] for x in xs), st.mean(x[1] for x in xs),
                        st.mean(x[2] for x in xs)))
    return out


def summarize(rows) -> dict:
    by = defaultdict(list)
    for close, t, pb, tb, pnl, won, price in rows:
        by[(pb, tb)].append((pnl, won, price))
    res = {}
    for k, xs in by.items():
        p = [x[0] for x in xs]
        res[k] = {"n": len(xs), "pnl": st.mean(p), "se": st.stdev(p) / math.sqrt(len(p)) if len(p) > 1 else None,
                  "won": st.mean(x[1] for x in xs), "price": st.mean(x[2] for x in xs)}
    return res


def run(series: str) -> None:
    data = load_trades(series)
    rows = market_rows(data)
    closes = sorted({r[0] for r in rows})
    cut = closes[len(closes) // 2]
    old, new = summarize([r for r in rows if r[0] < cut]), summarize([r for r in rows if r[0] >= cut])
    allr = summarize(rows)
    ntr = sum(len(m["trades"]) for m in data.values())
    print(f"\n{series}: {len(data)} markets, {ntr} trades. Taker P&L per contract after fee (¢), by price paid × minutes left.")
    print("  (older half → newer half; ★ = positive in both halves)")
    print("  price     " + "".join(f"| {lo:>4}-{hi:<2} min left        " for lo, hi in TIME_BINS))
    for pb in PRICE_BINS:
        cells = []
        for tb in TIME_BINS:
            a, o, n = allr.get((pb, tb)), old.get((pb, tb)), new.get((pb, tb))
            if not a or a["n"] < 20 or not o or not n:
                cells.append(f"| {'—':<24}")
                continue
            star = "★" if o["pnl"] > 0 and n["pnl"] > 0 else " "
            cells.append(f"| {100*o['pnl']:+5.1f} → {100*n['pnl']:+5.1f} (n{a['n']:3d}){star}   ")
        print(f"  {pb[0]*100:3.0f}-{pb[1]*100:3.0f}¢  " + "".join(cells))


if __name__ == "__main__" and sys.argv[1:2] != ["pool"]:
    for s in sys.argv[1:]:
        run(s)


def pooled(series_list: list[str]) -> None:
    """Every coin's markets pooled; a real bias should hold across coins and both halves."""
    rows_old, rows_new, per_coin = [], [], defaultdict(dict)
    for s in series_list:
        rows = market_rows(load_trades(s))
        closes = sorted({r[0] for r in rows})
        cut = closes[len(closes) // 2]
        rows_old += [r for r in rows if r[0] < cut]
        rows_new += [r for r in rows if r[0] >= cut]
        for k, v in summarize(rows).items():
            per_coin[k][s] = v["pnl"]
    old, new, allr = summarize(rows_old), summarize(rows_new), summarize(rows_old + rows_new)
    print(f"\nPOOLED {', '.join(series_list)}: taker P&L after fee (¢), older → newer, ± = SE over all")
    print("  coins+ = coins where this bucket is positive")
    for pb in PRICE_BINS:
        line = []
        for tb in TIME_BINS:
            a, o, n = allr.get((pb, tb)), old.get((pb, tb)), new.get((pb, tb))
            if not a or not o or not n:
                line.append(f"| {'—':<30}")
                continue
            pos = sum(v > 0 for v in per_coin[(pb, tb)].values())
            line.append(f"| {100*o['pnl']:+5.1f}→{100*n['pnl']:+5.1f} ±{100*a['se']:.1f} {pos}/{len(per_coin[(pb, tb)])} ")
        print(f"  {pb[0]*100:3.0f}-{pb[1]*100:3.0f}¢  " + "".join(line))


def maker_view(series_list: list[str]) -> None:
    """The other side of every taker trade: what a resting limit order earned, before any maker fee."""
    print("\nMAKER side (resting limit orders), P&L per contract before maker fee (¢), all markets pooled:")
    for s in series_list:
        data = load_trades(s)
        per_mkt = []
        for m in data.values():
            xs = []
            for ts, yes_price, taker_yes, count in m["trades"]:
                mins = (m["close"] - ts) / 60
                if not (0.33 <= mins <= 13):
                    continue
                taker_price = yes_price if taker_yes else 1 - yes_price
                taker_won = m["outcome"] if taker_yes else 1 - m["outcome"]
                xs.append(taker_price - taker_won)  # maker receives the price, pays out if taker wins
            if xs:
                per_mkt.append(st.mean(xs))
        se = st.stdev(per_mkt) / math.sqrt(len(per_mkt))
        print(f"  {s:10s} {100*st.mean(per_mkt):+5.2f}¢ ±{100*se:.2f} over {len(per_mkt)} markets")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "pool":
    pooled(sys.argv[2:])
    maker_view(sys.argv[2:])
