"""Replay the engine on Kalshi's own settled 15-minute markets.

For each settled market it takes Kalshi's real strike, real result, and the
real 1-minute Yes bid/ask history, plus Coinbase 1-minute spot candles. Every
minute from 2 to 14 minutes into the cycle it asks the engine for a decision
against the prices that were actually on the book. The first BUY per market is
the trade; P&L uses the ask paid and Kalshi's fee.

It reports two things the accuracy-only replay could not:
  * P&L per contract at the prices actually quoted.
  * Brier score of the model vs. Brier score of Kalshi's own mid price. The
    model only has an edge if it beats the market's Brier.

    python -m kalshi15m.backtest --series KXBTC15M --markets 300

Needs network access to api.elections.kalshi.com and api.exchange.coinbase.com.
No API key is needed; all endpoints used are public.
"""

from __future__ import annotations

import argparse
import csv
import math
import time
import urllib.parse
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from .assets import config_for, for_series
from .engine import Config, Engine, MarketSnapshot
from .feeds import KALSHI_API, _get_json, _ts
from .model import kalshi_fee

COINBASE_API = "https://api.exchange.coinbase.com"
CYCLE_S = 900
VOL_LOOKBACK_MIN = 30


# ---------- parsing (pure) ----------

def _cents_or_dollars(obj: dict | None, key: str = "close") -> float | None:
    """Kalshi candle OHLC blocks carry `close` in cents or `close_dollars` as a string."""
    if not obj:
        return None
    d = obj.get(f"{key}_dollars")
    if d not in (None, ""):
        v = float(d)
    elif obj.get(key) is not None:
        v = obj[key] / 100.0
    else:
        return None
    return v if 0.0 < v < 1.0 else None


def parse_kalshi_candles(payload: dict) -> dict[int, tuple[float | None, float | None]]:
    """end_period_ts -> (yes_bid, yes_ask) at that minute's close, in dollars."""
    out = {}
    for c in payload.get("candlesticks", []):
        ts = c.get("end_period_ts")
        if ts is None:
            continue
        out[int(ts)] = (_cents_or_dollars(c.get("yes_bid")), _cents_or_dollars(c.get("yes_ask")))
    return out


def parse_coinbase_candles(rows: list) -> dict[int, float]:
    """Coinbase rows are [time, low, high, open, close, volume]; keyed by the minute's END."""
    return {int(r[0]) + 60: float(r[4]) for r in rows}


@dataclass(frozen=True)
class SettledMarket:
    ticker: str
    strike: float
    close_ts: int
    outcome: int  # 1 = Yes/UP won


def parse_settled(m: dict) -> SettledMarket | None:
    if m.get("floor_strike") is None or m.get("result") not in ("yes", "no"):
        return None
    return SettledMarket(m["ticker"], float(m["floor_strike"]), int(_ts(m["close_time"])),
                         1 if m["result"] == "yes" else 0)


# ---------- replay (pure) ----------

@dataclass
class MarketResult:
    ticker: str
    outcome: int
    action: str = "SKIP"
    price: float | None = None
    minute: int | None = None
    pnl: float = 0.0
    model_sq: list | None = None  # squared errors of the model at each checkpoint
    market_sq: list | None = None  # squared errors of Kalshi's mid at the same checkpoints


def _vol_per_sec(spot: dict[int, float], end_ts: int) -> float | None:
    closes = [spot[t] for t in range(end_ts - 60 * VOL_LOOKBACK_MIN, end_ts + 1, 60) if t in spot]
    if len(closes) < 11:
        return None
    sq = [(b - a) ** 2 for a, b in zip(closes, closes[1:])]
    return math.sqrt(sum(sq) / len(sq) / 60)


def replay_market(m: SettledMarket, book: dict, spot: dict, cfg: Config) -> MarketResult:
    res = MarketResult(m.ticker, m.outcome, model_sq=[], market_sq=[])
    engine = Engine(replace(cfg, stable_readings=1, max_spot_age_s=1e9, max_book_age_s=1e9))
    open_ts = m.close_ts - CYCLE_S
    for minute in range(2, 15):
        ts = open_ts + 60 * minute
        px, (bid, ask) = spot.get(ts), book.get(ts, (None, None))
        if px is None or (bid is None and ask is None):
            continue
        snap = MarketSnapshot(m.ticker, m.strike, m.close_ts, ask,
                              None if bid is None else round(1.0 - bid, 4), ts)
        d = engine.evaluate(ts, snap, px, ts, _vol_per_sec(spot, ts))
        if d.fair is None:
            continue
        res.model_sq.append((d.fair.prob_yes - m.outcome) ** 2)
        if bid is not None and ask is not None:
            res.market_sq.append(((bid + ask) / 2 - m.outcome) ** 2)
        if res.action == "SKIP" and d.action != "SKIP":
            won = m.outcome if d.action == "BUY_YES" else 1 - m.outcome
            price = snap.yes_ask if d.action == "BUY_YES" else snap.no_ask
            res.action, res.price, res.minute = d.action, price, minute
            res.pnl = won - price - kalshi_fee(price)
    return res


def summarize(results: list[MarketResult]) -> dict:
    trades = [r for r in results if r.action != "SKIP"]
    msq = [x for r in results for x in r.model_sq]
    ksq = [x for r in results for x in r.market_sq]
    wins = sum(1 for r in trades if r.pnl > 0)
    return {
        "markets": len(results),
        "trades": len(trades),
        "win_rate": wins / len(trades) if trades else None,
        "avg_price": sum(r.price for r in trades) / len(trades) if trades else None,
        "pnl_total": sum(r.pnl for r in trades),
        "pnl_per_trade": sum(r.pnl for r in trades) / len(trades) if trades else None,
        "brier_model": sum(msq) / len(msq) if msq else None,
        "brier_market": sum(ksq) / len(ksq) if ksq else None,
    }


# ---------- network ----------

def fetch_settled(series: str, n: int) -> list[SettledMarket]:
    out, cursor = [], None
    while len(out) < n:
        q = {"series_ticker": series, "status": "settled", "limit": 200}
        if cursor:
            q["cursor"] = cursor
        data = _get_json(f"{KALSHI_API}/markets?{urllib.parse.urlencode(q)}")
        out += [s for m in data.get("markets", []) if (s := parse_settled(m))]
        cursor = data.get("cursor")
        if not cursor:
            break
    return out[:n]


def fetch_book(series: str, m: SettledMarket) -> dict:
    q = urllib.parse.urlencode({"start_ts": m.close_ts - CYCLE_S, "end_ts": m.close_ts, "period_interval": 1})
    return parse_kalshi_candles(_get_json(f"{KALSHI_API}/series/{series}/markets/{m.ticker}/candlesticks?{q}"))


def fetch_spot(product: str, start: int, end: int) -> dict[int, float]:
    out: dict[int, float] = {}
    t = start
    while t < end:
        stop = min(t + 300 * 60, end)
        iso = lambda x: datetime.fromtimestamp(x, timezone.utc).isoformat()
        q = urllib.parse.urlencode({"granularity": 60, "start": iso(t), "end": iso(stop)})
        out.update(parse_coinbase_candles(_get_json(f"{COINBASE_API}/products/{product}/candles?{q}")))
        t = stop
        time.sleep(0.2)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--series", default="KXBTC15M")
    ap.add_argument("--markets", type=int, default=200)
    ap.add_argument("--vol-mult", type=float, help="override the asset profile")
    ap.add_argument("--min-edge", type=float, help="override the asset profile (dollars)")
    ap.add_argument("--csv", default="backtest.csv")
    args = ap.parse_args()

    profile = for_series(args.series)
    cfg = config_for(args.series)
    if args.vol_mult is not None:
        cfg = replace(cfg, vol_mult=args.vol_mult)
    if args.min_edge is not None:
        cfg = replace(cfg, min_edge=args.min_edge)

    markets = fetch_settled(args.series, args.markets)
    if not markets:
        raise SystemExit(f"No settled markets with a strike found for {args.series}.")
    spot = fetch_spot(profile.product,
                      min(m.close_ts for m in markets) - CYCLE_S - 60 * (VOL_LOOKBACK_MIN + 1),
                      max(m.close_ts for m in markets))

    results = []
    for i, m in enumerate(markets, 1):
        try:
            results.append(replay_market(m, fetch_book(args.series, m), spot, cfg))
        except Exception as e:  # one bad market shouldn't sink the run
            print(f"skip {m.ticker}: {e}")
        time.sleep(0.1)
        if i % 25 == 0:
            print(f"{i}/{len(markets)} markets replayed")

    with open(args.csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ticker", "outcome", "action", "price", "minute", "pnl"])
        for r in results:
            w.writerow([r.ticker, r.outcome, r.action, r.price, r.minute, round(r.pnl, 4)])

    s = summarize(results)
    fmt = lambda v, f: "—" if v is None else format(v, f)
    print(f"\n{args.series}  vol x{cfg.vol_mult}  min edge {cfg.min_edge*100:.0f}c")
    print(f"markets {s['markets']}  trades {s['trades']}  win rate {fmt(s['win_rate'], '.0%')}  avg price {fmt(s['avg_price'], '.2f')}")
    print(f"P&L {s['pnl_total']:+.2f} total, {fmt(s['pnl_per_trade'], '+.3f')} per contract")
    print(f"Brier model {fmt(s['brier_model'], '.3f')} vs Kalshi mid {fmt(s['brier_market'], '.3f')}"
          " (model needs the lower number to have an edge)")
    print(f"rows written to {args.csv}")


if __name__ == "__main__":
    main()
