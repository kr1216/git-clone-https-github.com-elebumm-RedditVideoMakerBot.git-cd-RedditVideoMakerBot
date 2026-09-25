"""Paper-trading loop: `python -m kalshi15m --series KXBTC15M --product BTC-USD`.

Prints one line per tick and appends every decision to a JSONL ledger. It never
places orders. Settle the ledger later against Kalshi results to measure Brier
score and PnL at the quoted entry price.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace

from .assets import config_for, for_series
from .engine import Engine
from .feeds import CoinbaseSpot, fetch_current_market
from .model import SETTLE_WINDOW_S, realized_vol_per_sec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--series", default="KXBTC15M")
    ap.add_argument("--product", help="Coinbase product; defaults to the series' asset profile")
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--vol-lookback", type=int, default=300, help="seconds")
    ap.add_argument("--min-edge", type=float, help="dollars; defaults to the asset profile")
    ap.add_argument("--ledger", default="ledger.jsonl")
    args = ap.parse_args()

    cfg = config_for(args.series)
    if args.min_edge is not None:
        cfg = replace(cfg, min_edge=args.min_edge)
    spot = CoinbaseSpot(args.product or for_series(args.series).product)
    spot.start()
    engine = Engine(cfg)
    mkt, current_ticker = None, None

    while True:
        now = time.time()
        try:
            fresh = fetch_current_market(args.series)
            if fresh is not None:
                mkt = fresh
        except Exception as e:  # network hiccup: keep the last snapshot, engine will see it stale
            print(f"kalshi error: {e}")
        if mkt is None:
            time.sleep(args.interval)
            continue
        if mkt.ticker != current_ticker:
            engine = Engine(engine.cfg)
            current_ticker = mkt.ticker

        price, ts, samples = spot.snapshot(now - args.vol_lookback)
        vol = realized_vol_per_sec(samples)
        # Approximates the CF RTI with Coinbase spot for the settlement window.
        window = [p for t, p in samples if t >= mkt.close_ts - SETTLE_WINDOW_S]
        d = engine.evaluate(now, mkt, price, ts, vol, sum(window), len(window))

        s_left = mkt.close_ts - now
        p = f"{d.fair.prob_yes:.3f}" if d.fair else "  -  "
        print(
            f"{mkt.ticker} {s_left:5.0f}s spot={price} strike={mkt.strike} "
            f"fair_up={p} yes_ask={mkt.yes_ask} no_ask={mkt.no_ask} "
            f"-> {d.action} {d.side} {'; '.join(d.reasons)}"
        )
        with open(args.ledger, "a") as f:
            f.write(json.dumps({
                "ts": now, "ticker": mkt.ticker, "strike": mkt.strike, "spot": price,
                "s_left": s_left, "vol": vol, "fair_up": d.fair.prob_yes if d.fair else None,
                "yes_ask": mkt.yes_ask, "no_ask": mkt.no_ask, "action": d.action,
                "edge_yes": d.edge_yes, "edge_no": d.edge_no,
            }) + "\n")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
