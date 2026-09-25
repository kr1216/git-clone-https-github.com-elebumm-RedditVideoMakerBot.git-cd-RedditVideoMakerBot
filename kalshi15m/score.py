"""Score a paper-loop ledger against Kalshi's settlements.

    python -m kalshi15m.score ledger-sol.jsonl

The first BUY in each market is the paper trade, at the ask the loop saw, with
Kalshi's fee: the same rule the backtest uses. Brier compares the model's
fair_up with Kalshi's mid, (yes_ask + 1 - no_ask) / 2, once per minute per
market, over settled markets only. Read-only; no API key.
"""

from __future__ import annotations

import argparse
import json
import urllib.parse

from .backtest import _get_json, summarize, MarketResult
from .feeds import KALSHI_API
from .model import kalshi_fee


def load_ledger(path: str) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def score(rows: list[dict], results: dict[str, int]) -> list[MarketResult]:
    """rows: ledger lines in time order; results: ticker -> 1 (Yes won) / 0, settled only."""
    by_ticker: dict[str, MarketResult] = {}
    seen_minute: set[tuple[str, int]] = set()
    for r in rows:
        t = r["ticker"]
        if t not in results:
            continue
        outcome = results[t]
        res = by_ticker.setdefault(t, MarketResult(t, outcome, model_sq=[], market_sq=[]))
        minute = int(r["ts"] // 60)
        if r.get("fair_up") is not None and (t, minute) not in seen_minute:
            seen_minute.add((t, minute))
            res.model_sq.append((r["fair_up"] - outcome) ** 2)
            if r.get("yes_ask") is not None and r.get("no_ask") is not None:
                res.market_sq.append(((r["yes_ask"] + 1 - r["no_ask"]) / 2 - outcome) ** 2)
        if res.action == "SKIP" and r["action"] in ("BUY_YES", "BUY_NO"):
            price = r["yes_ask"] if r["action"] == "BUY_YES" else r["no_ask"]
            won = outcome if r["action"] == "BUY_YES" else 1 - outcome
            res.action, res.price = r["action"], price
            res.pnl = won - price - kalshi_fee(price)
    return list(by_ticker.values())


def fetch_results(tickers: set[str]) -> dict[str, int]:
    out = {}
    for t in sorted(tickers):
        m = _get_json(f"{KALSHI_API}/markets/{urllib.parse.quote(t)}").get("market", {})
        if m.get("result") in ("yes", "no"):
            out[t] = 1 if m["result"] == "yes" else 0
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("ledger", nargs="?", default="ledger.jsonl")
    args = ap.parse_args()

    rows = load_ledger(args.ledger)
    results = fetch_results({r["ticker"] for r in rows})
    s = summarize(score(rows, results))
    fmt = lambda v, f: "—" if v is None else format(v, f)
    print(f"{args.ledger}: {len(rows)} ticks, {s['markets']} settled markets, {s['trades']} paper trades")
    print(f"win rate {fmt(s['win_rate'], '.0%')}  avg price {fmt(s['avg_price'], '.2f')}"
          f"  P&L {s['pnl_total']:+.2f} ({fmt(s['pnl_per_trade'], '+.3f')}/contract)")
    print(f"Brier model {fmt(s['brier_model'], '.3f')} vs Kalshi mid {fmt(s['brier_market'], '.3f')}")


if __name__ == "__main__":
    main()
