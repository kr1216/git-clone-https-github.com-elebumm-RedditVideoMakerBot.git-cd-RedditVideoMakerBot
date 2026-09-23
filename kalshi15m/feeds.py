"""Public data feeds: Kalshi REST (strike + book) and Coinbase spot WebSocket.

Read-only; no authentication and no order placement.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.parse
import urllib.request
from collections import deque
from datetime import datetime

from .engine import MarketSnapshot

KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2"
COINBASE_WS = "wss://ws-feed.exchange.coinbase.com"


def _get_json(url: str, timeout: float = 5.0) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def _price(m: dict, key: str) -> float | None:
    """Kalshi returns prices as `<key>_dollars` strings or legacy integer cents."""
    d = m.get(f"{key}_dollars")
    if d not in (None, ""):
        v = float(d)
    elif m.get(key) is not None:
        v = m[key] / 100.0
    else:
        return None
    return v if 0.0 < v < 1.0 else None


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def parse_market(m: dict, fetched_ts: float) -> MarketSnapshot | None:
    strike = m.get("floor_strike")
    if strike is None:
        return None  # no real strike yet: never act on a placeholder
    yes_bid = _price(m, "yes_bid")
    no_ask = _price(m, "no_ask")
    if no_ask is None and yes_bid is not None:
        no_ask = round(1.0 - yes_bid, 4)
    return MarketSnapshot(
        ticker=m["ticker"],
        strike=float(strike),
        close_ts=_ts(m["close_time"]),
        yes_ask=_price(m, "yes_ask"),
        no_ask=no_ask,
        fetched_ts=fetched_ts,
    )


def fetch_current_market(series: str = "KXBTC15M") -> MarketSnapshot | None:
    """The open market in `series` that closes soonest."""
    q = urllib.parse.urlencode({"series_ticker": series, "status": "open", "limit": 20})
    data = _get_json(f"{KALSHI_API}/markets?{q}")
    now = time.time()
    snaps = [s for m in data.get("markets", []) if (s := parse_market(m, now))]
    snaps = [s for s in snaps if s.close_ts > now]
    return min(snaps, key=lambda s: s.close_ts) if snaps else None


class CoinbaseSpot:
    """Background thread keeping the last price and a rolling 1s sample history."""

    def __init__(self, product: str = "BTC-USD", history_s: int = 900):
        self.product = product
        self.price: float | None = None
        self.ts: float | None = None
        self.samples: deque[tuple[float, float]] = deque(maxlen=history_s)
        self._lock = threading.Lock()

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True).start()

    def _on_price(self, price: float) -> None:
        now = time.time()
        with self._lock:
            self.price, self.ts = price, now
            if not self.samples or now - self.samples[-1][0] >= 1.0:
                self.samples.append((now, price))

    def _run(self) -> None:
        import asyncio

        import websockets

        async def loop() -> None:
            sub = {"type": "subscribe", "product_ids": [self.product], "channels": ["ticker"]}
            while True:
                try:
                    async with websockets.connect(COINBASE_WS, ping_interval=20) as ws:
                        await ws.send(json.dumps(sub))
                        async for raw in ws:
                            msg = json.loads(raw)
                            if msg.get("type") == "ticker" and "price" in msg:
                                self._on_price(float(msg["price"]))
                except Exception:
                    await asyncio.sleep(2)

        asyncio.run(loop())

    def snapshot(self, since: float) -> tuple[float | None, float | None, list[tuple[float, float]]]:
        with self._lock:
            return self.price, self.ts, [s for s in self.samples if s[0] >= since]
