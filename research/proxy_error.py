"""How well does Coinbase stand in for the CF Benchmarks index Kalshi settles on?

Kalshi publishes each market's official settlement value (`expiration_value`, the
60-second index average). Compare it with the Coinbase 1-minute close proxy for
the same minute, and with the market's distance from its strike.

    PYTHONPATH=. python -m research.proxy_error SOL NEAR
"""

from __future__ import annotations

import statistics as st
import sys
import urllib.parse

from kalshi15m.backtest import KALSHI_API, _get_json, _ts, load_dataset

from .features import ASSETS


def settlement_values(series: str, n: int) -> dict[str, tuple[int, float]]:
    out, cursor = {}, None
    while len(out) < n:
        q = {"series_ticker": series, "status": "settled", "limit": 200}
        if cursor:
            q["cursor"] = cursor
        d = _get_json(f"{KALSHI_API}/markets?{urllib.parse.urlencode(q)}")
        for m in d.get("markets", []):
            if m.get("expiration_value") not in (None, ""):
                out[m["ticker"]] = (int(_ts(m["close_time"])), float(m["expiration_value"]))
        cursor = d.get("cursor")
        if not cursor:
            break
    return out


def main(assets):
    for a in assets:
        markets, _, spot = load_dataset(ASSETS[a], 1000)
        ev = settlement_values(ASSETS[a], 1000)
        err, flips, near = [], 0, 0
        for m in markets:
            if m.ticker not in ev:
                continue
            close, v = ev[m.ticker]
            p0, p1 = spot.get(close - 60), spot.get(close)
            if p0 is None or p1 is None:
                continue
            proxy = (p0 + p1) / 2
            err.append(proxy - v)
            if (proxy >= m.strike) != (v >= m.strike):
                flips += 1
            near += abs(v - m.strike) < 2 * st.pstdev(err) if len(err) > 20 else 0
        e = sorted(err)
        print(f"{a}: n={len(err)}  Coinbase proxy - official: median {st.median(e):+.5g}"
              f"  sd {st.pstdev(e):.5g}  p5 {e[len(e)//20]:+.5g}  p95 {e[19*len(e)//20]:+.5g}"
              f"  | proxy picks the wrong side in {flips} markets ({flips/len(err):.1%})")


if __name__ == "__main__":
    main(sys.argv[1:] or list(ASSETS))
