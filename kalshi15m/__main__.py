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
from .backtest import VOL_LOOKBACK_MIN, _vol_per_sec, fetch_spot
from .engine import Engine
from .feeds import CoinbaseSpot, fetch_current_market
from .model import SETTLE_WINDOW_S

VOL_REFRESH_S = 60
VOL_MAX_AGE_S = 300


def candle_vol(product: str, now: float) -> float | None:
    """Dollar vol per sqrt-second from Coinbase 1-minute closes over the last 30 minutes.

    Same estimator as the backtest, so live decisions use the settings it graded.
    (1-second ticks over a few seconds badly understate vol at startup.)
    """
    end = int(now // 60) * 60  # end of the last completed minute
    spot = fetch_spot(product, end - 60 * (VOL_LOOKBACK_MIN + 2), end)
    return _vol_per_sec(spot, end)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--series", default="KXBTC15M")
    ap.add_argument("--product", help="Coinbase product; defaults to the series' asset profile")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between Kalshi polls")
    ap.add_argument("--stable-readings", type=int, default=1,
                    help="same side N ticks in a row before acting (the backtest measured 1)")
    ap.add_argument("--no-blend", action="store_true", help="trade on the price model alone")
    ap.add_argument("--min-edge", type=float, help="dollars; defaults to the asset profile")
    ap.add_argument("--ledger", default="ledger.jsonl")
    args = ap.parse_args()

    cfg = replace(config_for(args.series), stable_readings=args.stable_readings)
    if args.no_blend:
        cfg = replace(cfg, blend=None)
    if for_series(args.series).verdict == "none":
        print(f"warning: {args.series} lost money in the Kalshi backtest at every setting; "
              "this ledger is for study only (docs/vixyvault-analysis.md, section 6)")
    if args.min_edge is not None:
        cfg = replace(cfg, min_edge=args.min_edge)
    product = args.product or for_series(args.series).product
    spot = CoinbaseSpot(product)
    spot.start()
    vol, vol_ts = None, 0.0
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

        if now - vol_ts >= VOL_REFRESH_S:
            try:
                vol, vol_ts = candle_vol(product, now), now
            except Exception as e:  # keep the last estimate until it is too old
                print(f"coinbase candles error: {e}")
                if now - vol_ts > VOL_MAX_AGE_S:
                    vol = None
        price, ts, samples = spot.snapshot(now - SETTLE_WINDOW_S - 5)
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
                "model_up": d.model_prob,
                "yes_ask": mkt.yes_ask, "no_ask": mkt.no_ask, "action": d.action,
                "edge_yes": d.edge_yes, "edge_no": d.edge_no,
            }) + "\n")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
