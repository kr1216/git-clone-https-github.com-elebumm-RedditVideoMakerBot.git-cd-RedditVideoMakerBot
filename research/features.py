"""Turn cached backtest data into one row per market-minute for model research.

Reads .cache/kalshi15m/<series>-<n>.json (written by `python -m kalshi15m.backtest`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from kalshi15m.backtest import CYCLE_S, load_dataset

ASSETS = {"BTC": "KXBTC15M", "ETH": "KXETH15M", "SOL": "KXSOL15M",
          "XRP": "KXXRP15M", "DOGE": "KXDOGE15M", "NEAR": "KXNEAR15M"}


@dataclass
class Row:
    ticker: str
    close_ts: int
    minute: int  # minutes into the cycle (2..14)
    s_left: float
    spot: float
    strike: float
    basis: float | None  # Coinbase proxy for the strike window minus the strike
    vols: dict  # lookback minutes -> $ vol per sqrt-second from 1-min closes
    bid: float | None
    ask: float | None
    outcome: int
    momentum: float | None  # spot change over the last 5 minutes

    @property
    def mid(self) -> float | None:
        return None if self.bid is None or self.ask is None else (self.bid + self.ask) / 2

    @property
    def no_ask(self) -> float | None:
        return None if self.bid is None else round(1 - self.bid, 4)


def vol_at(spot: dict, end: int, lookback: int) -> float | None:
    closes = [spot[t] for t in range(end - 60 * lookback, end + 1, 60) if t in spot]
    if len(closes) < max(6, lookback // 3):
        return None
    sq = [(b - a) ** 2 for a, b in zip(closes, closes[1:])]
    return math.sqrt(sum(sq) / len(sq) / 60)


def rows_for(asset: str, n: int = 1000, lookbacks=(10, 15, 30, 60)) -> list[Row]:
    markets, books, spot = load_dataset(ASSETS[asset], n)
    out = []
    for m in markets:
        book = books.get(m.ticker)
        if book is None:
            continue
        open_ts = m.close_ts - CYCLE_S
        # The strike is the index average over the 60s before open, i.e. the minute ending at open_ts.
        # A Coinbase proxy for that average: mean of the closes bracketing that minute.
        a, b = spot.get(open_ts - 60), spot.get(open_ts)
        basis = (a + b) / 2 - m.strike if a is not None and b is not None else None
        for minute in range(2, 15):
            ts = open_ts + 60 * minute
            px = spot.get(ts)
            bid, ask = book.get(ts, (None, None))
            if px is None or (bid is None and ask is None):
                continue
            p5 = spot.get(ts - 300)
            out.append(Row(m.ticker, m.close_ts, minute, float(m.close_ts - ts), px, m.strike, basis,
                           {k: vol_at(spot, ts, k) for k in lookbacks}, bid, ask, m.outcome,
                           None if p5 is None else px - p5))
    return out
