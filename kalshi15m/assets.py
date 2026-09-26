"""Per-asset settings for Kalshi 15-minute series.

From Kalshi's own settled markets and 1-minute bid/ask, 2026-09-15 to 09-25
(docs/vixyvault-analysis.md section 6, docs/model-research.md). The engine trades
on a blend of the price model and Kalshi's mid:
    logit p = a*logit(model) + b*logit(Kalshi mid) + c
vol_mult was fitted for accuracy (log loss). Blend weights were fitted on all
1000 markets; with weights fitted on the older 500, the blend at a 3c minimum edge
made +3.6c (SOL), +4.8c (NEAR), +5.1c (DOGE) per contract on the newer 500.
Against Kalshi's real trades (research/trade_backtest.py), SOL and NEAR made money
only when acting on Coinbase prices at most seconds old; DOGE did not, so it is "none".

verdict: "edge"  made money on held-out markets and beat Kalshi's accuracy
         "weak"  same, but within about 1.5 standard errors of zero
         "none"  lost money or matched Kalshi at best; paper only, do not trade
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
    tier: str  # "core" | "thin" (price feed quality on Crypto.com, used by the Strike Desk)
    verdict: str  # "edge" | "weak" | "none", see module docstring
    blend: tuple[float, float, float] | None = None  # (a, b, c), see module docstring


PROFILES: dict[str, AssetProfile] = {
    "BTC": AssetProfile("KXBTC15M", "BTC-USD", 1.15, 0.03, "core", "none", (0.125, 0.935, -0.025)),
    "ETH": AssetProfile("KXETH15M", "ETH-USD", 0.9, 0.03, "core", "none", (0.189, 0.866, 0.002)),
    "SOL": AssetProfile("KXSOL15M", "SOL-USD", 0.9, 0.03, "core", "edge", (0.649, 0.375, 0.012)),
    "XRP": AssetProfile("KXXRP15M", "XRP-USD", 0.9, 0.03, "core", "none", (0.473, 0.598, 0.067)),
    "DOGE": AssetProfile("KXDOGE15M", "DOGE-USD", 0.9, 0.03, "thin", "none", (0.464, 0.605, 0.057)),
    "NEAR": AssetProfile("KXNEAR15M", "NEAR-USD", 1.0, 0.03, "thin", "weak", (0.614, 0.437, 0.109)),
}


def for_series(series: str) -> AssetProfile:
    for p in PROFILES.values():
        if p.series == series:
            return p
    raise KeyError(f"no profile for series {series!r}; known: {[p.series for p in PROFILES.values()]}")


def config_for(series: str, base: Config | None = None) -> Config:
    p = for_series(series)
    return replace(base or Config(), vol_mult=p.vol_mult, min_edge=p.min_edge, blend=p.blend)
