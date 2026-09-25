"""Score probability models on market-minute rows: accuracy and after-fee trading P&L.

Trading rule matches the backtest: per market, the first minute (2..14) where the
best side's EV after Kalshi's fee clears `min_edge` and its price is <= max_price.
"""

from __future__ import annotations

import math
import statistics as st
from collections import defaultdict
from typing import Callable

from kalshi15m.model import kalshi_fee, norm_cdf

from .features import Row

ProbFn = Callable[[Row], "float | None"]


def split(rows: list[Row]) -> tuple[list[Row], list[Row]]:
    """(older half, newer half) by market close time."""
    closes = sorted({r.close_ts for r in rows})
    cut = closes[len(closes) // 2]
    return [r for r in rows if r.close_ts < cut], [r for r in rows if r.close_ts >= cut]


def brier(rows: list[Row], f: ProbFn) -> float | None:
    sq = [(p - r.outcome) ** 2 for r in rows if (p := f(r)) is not None]
    return sum(sq) / len(sq) if sq else None


def logloss(rows: list[Row], f: ProbFn) -> float | None:
    ll = []
    for r in rows:
        p = f(r)
        if p is None:
            continue
        p = min(max(p, 1e-4), 1 - 1e-4)
        ll.append(-math.log(p if r.outcome else 1 - p))
    return sum(ll) / len(ll) if ll else None


def trades(rows: list[Row], f: ProbFn, min_edge: float, max_price: float = 0.92,
           min_price: float = 0.0, max_gap: float = 1.0) -> list[float]:
    """P&L per contract of the first qualifying trade in each market.

    min_price: skip contracts cheaper than this (long shots).
    max_gap: skip when |model - Kalshi mid| exceeds this (model probably wrong).
    """
    by_mkt = defaultdict(list)
    for r in rows:
        by_mkt[r.ticker].append(r)
    pnls = []
    for rs in by_mkt.values():
        for r in sorted(rs, key=lambda x: x.minute):
            p = f(r)
            if p is None:
                continue
            if r.mid is not None and abs(p - r.mid) > max_gap:
                continue
            best = None
            for side, price, pw, won in (("Y", r.ask, p, r.outcome), ("N", r.no_ask, 1 - p, 1 - r.outcome)):
                if price is None or not (min_price <= price <= max_price):
                    continue
                edge = pw - price - kalshi_fee(price)
                if edge >= min_edge and (best is None or edge > best[0]):
                    best = (edge, won - price - kalshi_fee(price))
            if best:
                pnls.append(best[1])
                break
    return pnls


def pnl_stats(p: list[float]) -> dict:
    if not p:
        return {"n": 0, "c": None, "se": None}
    return {"n": len(p), "c": 100 * st.mean(p), "se": 100 * st.stdev(p) / math.sqrt(len(p)) if len(p) > 1 else None}


def fmt(s: dict) -> str:
    if not s["n"]:
        return "   0 trades"
    se = f"±{s['se']:.1f}" if s["se"] is not None else ""
    return f"{s['n']:4d} tr {s['c']:+5.1f}c{se:>6}"


# ---------- probability models ----------

def gbm_prob(spot: float, strike: float, s_left: float, vol: float) -> float:
    """Kalshi 60s-average settlement under arithmetic Brownian motion (see kalshi15m/model.py)."""
    t = max(s_left, 0.0)
    var = vol ** 2 * (max(t - 60, 0) + min(t, 60) / 3)
    if var <= 0:
        return 1.0 if spot >= strike else 0.0
    return norm_cdf((spot - strike) / math.sqrt(var))
