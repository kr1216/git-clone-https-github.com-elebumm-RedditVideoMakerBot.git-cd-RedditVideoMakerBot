"""Kalshi's executed trades for settled 15-minute markets: real prices, real fills.

    PYTHONPATH=. python -m research.trades fetch KXSOL15M 300

Caches .cache/kalshi15m/trades-<series>-<n>.json as {ticker: {"close": ts,
"strike": x, "outcome": 0/1, "trades": [[ts, yes_price, taker_yes(1/0), count], ...]}}.
Markets come from the backtest cache (`python -m kalshi15m.backtest --markets 1000`).
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse

from kalshi15m.backtest import KALSHI_API, _get_json, _ts, load_dataset

CACHE = ".cache/kalshi15m"


def fetch_trades(ticker: str) -> list[list]:
    out, cursor = [], None
    while True:
        q = {"ticker": ticker, "limit": 1000}
        if cursor:
            q["cursor"] = cursor
        d = _get_json(f"{KALSHI_API}/markets/trades?{urllib.parse.urlencode(q)}")
        for t in d.get("trades", []):
            out.append([_ts(t["created_time"]), float(t["yes_price_dollars"]),
                        1 if t["taker_side"] == "yes" else 0, float(t.get("count_fp") or 1)])
        cursor = d.get("cursor")
        if not cursor or not d.get("trades"):
            return sorted(out)
        time.sleep(0.05)


def load_trades(series: str, n: int = 300) -> dict:
    path = os.path.join(CACHE, f"trades-{series}-{n}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    markets, _, _ = load_dataset(series, 1000)
    markets = sorted(markets, key=lambda m: m.close_ts)[-n:]
    data = {}
    for i, m in enumerate(markets, 1):
        try:
            data[m.ticker] = {"close": m.close_ts, "strike": m.strike, "outcome": m.outcome,
                              "trades": fetch_trades(m.ticker)}
        except Exception as e:
            print(f"skip {m.ticker}: {e}")
        if i % 50 == 0:
            print(f"{series}: {i}/{len(markets)} markets", flush=True)
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


if __name__ == "__main__":
    if sys.argv[1] == "fetch":
        d = load_trades(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 300)
        print(sys.argv[2], len(d), "markets,", sum(len(v["trades"]) for v in d.values()), "trades")
