"""Do live REST quotes match the 1-minute candle closes the backtest replays?

For settled markets in a paper-loop ledger, compare the ledger's Kalshi yes_ask
(and 1 - no_ask as yes_bid) in the last seconds of each minute with the
candlestick close for that minute, and count how often each would trade.

    PYTHONPATH=. python -m research.live_vs_candles ledger-sol-blend.jsonl KXSOL15M
"""

from __future__ import annotations

import statistics as st
import sys
from collections import defaultdict

from kalshi15m.backtest import CYCLE_S, SettledMarket, fetch_book
from kalshi15m.score import fetch_results, load_ledger


def main(ledger: str, series: str) -> None:
    rows = load_ledger(ledger)
    res = fetch_results({r["ticker"] for r in rows})
    by = defaultdict(list)
    for r in rows:
        if r["ticker"] in res:
            by[r["ticker"]].append(r)
    d_ask, d_bid, n = [], [], 0
    for t, rs in list(by.items())[:40]:
        close = int(round(rs[0]["ts"] + rs[0]["s_left"]))
        book = fetch_book(series, SettledMarket(t, rs[0]["strike"], close, res[t]))
        for minute in range(2, 15):
            end = close - CYCLE_S + 60 * minute
            near = [r for r in rs if end - 5 <= r["ts"] <= end and r["yes_ask"] is not None and r["no_ask"] is not None]
            if not near or end not in book or None in book[end]:
                continue
            live = near[-1]
            bid, ask = book[end]
            d_ask.append(live["yes_ask"] - ask)
            d_bid.append((1 - live["no_ask"]) - bid)
            n += 1
    ab = lambda xs: st.mean(abs(x) for x in xs)
    print(f"{ledger}: {n} minute marks. live - candle close: ask mean {st.mean(d_ask):+.4f} (|{ab(d_ask):.4f}|),"
          f" bid mean {st.mean(d_bid):+.4f} (|{ab(d_bid):.4f}|);"
          f" exact match ask {sum(abs(x) < 1e-9 for x in d_ask)/n:.0%}, bid {sum(abs(x) < 1e-9 for x in d_bid)/n:.0%}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
