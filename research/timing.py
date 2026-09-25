"""Where does the edge come from? P&L by entry minute and with a one-minute fill delay.

The delay test decides at minute m but pays the ask quoted at minute m+1. If the
profit disappears, the edge is a stale quote that needs speed to capture.

    PYTHONPATH=. python -m research.timing SOL NEAR
"""

from __future__ import annotations

import sys
from collections import defaultdict

from kalshi15m.assets import PROFILES
from kalshi15m.model import kalshi_fee

from .evaluate import fmt, pnl_stats, split
from .experiments import model
from .features import rows_for


def run(asset: str, edge: float | None = None, f=None, label: str = "", rows=None) -> dict:
    prof = PROFILES[asset]
    edge = edge if edge is not None else prof.min_edge
    f = f or model(prof.vol_mult)
    label = label or f"vol x{prof.vol_mult}"
    rows = rows if rows is not None else [r for r in rows_for(asset) if r.mid is not None]
    by = defaultdict(dict)
    for r in rows:
        by[r.ticker][r.minute] = r
    now, late, per_min = [], [], defaultdict(list)
    for mk in by.values():
        for m in sorted(mk):
            r = mk[m]
            p = f(r)
            if p is None:
                continue
            best = None
            for side, price, pw in (("Y", r.ask, p), ("N", r.no_ask, 1 - p)):
                if price is None or price > 0.92:
                    continue
                e = pw - price - kalshi_fee(price)
                if e >= edge and (best is None or e > best[0]):
                    best = (e, side, price)
            if not best:
                continue
            _, side, price = best
            won = r.outcome if side == "Y" else 1 - r.outcome
            pnl = won - price - kalshi_fee(price)
            now.append(pnl)
            per_min[m].append(pnl)
            nxt = mk.get(m + 1)
            lp = None if nxt is None else (nxt.ask if side == "Y" else nxt.no_ask)
            if lp is not None and lp <= 0.99:
                late.append(won - lp - kalshi_fee(lp))
            break
    print(f"\n{asset} ({label}, {edge*100:.0f}c): fill now {fmt(pnl_stats(now))}"
          f" | fill 1 min later {fmt(pnl_stats(late))}")
    for lo, hi in ((2, 4), (5, 8), (9, 11), (12, 14)):
        xs = [x for m in range(lo, hi + 1) for x in per_min[m]]
        print(f"   entry minute {lo:2d}-{hi:2d}: {fmt(pnl_stats(xs))}")
    return {"now": pnl_stats(now), "late": pnl_stats(late)}


if __name__ == "__main__":
    for a in sys.argv[1:] or ["SOL", "NEAR"]:
        run(a)
