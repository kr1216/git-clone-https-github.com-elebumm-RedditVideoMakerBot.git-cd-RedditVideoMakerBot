"""Per-asset settings for Kalshi 15-minute series.

Defaults come from the 2026-09-25 replay (14 cycles per asset on Crypto.com
5-minute candles): BTC calibrated at 1.15x realized volatility, the others
needed about 1.5x. "thin" assets had noisy price feeds and scored near a coin
flip, so they need a larger edge before the engine acts. Re-derive these from
`python -m kalshi15m.backtest` once it has run on Kalshi's own history.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .engine import Config


@dataclass(frozen=True)
class AssetProfile:
    series: str  # Kalshi series ticker
    product: str  # Coinbase Exchange product id
    vol_mult: float
    min_edge: float  # dollars per contract after fees
    tier: str  # "core" | "thin"


PROFILES: dict[str, AssetProfile] = {
    "BTC": AssetProfile("KXBTC15M", "BTC-USD", 1.15, 0.03, "core"),
    "ETH": AssetProfile("KXETH15M", "ETH-USD", 1.5, 0.04, "core"),
    "SOL": AssetProfile("KXSOL15M", "SOL-USD", 1.5, 0.03, "core"),
    "XRP": AssetProfile("KXXRP15M", "XRP-USD", 1.5, 0.03, "core"),
    "DOGE": AssetProfile("KXDOGE15M", "DOGE-USD", 1.5, 0.08, "thin"),
    "NEAR": AssetProfile("KXNEAR15M", "NEAR-USD", 1.5, 0.08, "thin"),
}


def for_series(series: str) -> AssetProfile:
    for p in PROFILES.values():
        if p.series == series:
            return p
    raise KeyError(f"no profile for series {series!r}; known: {[p.series for p in PROFILES.values()]}")


def config_for(series: str, base: Config | None = None) -> Config:
    p = for_series(series)
    return replace(base or Config(), vol_mult=p.vol_mult, min_edge=p.min_edge)
