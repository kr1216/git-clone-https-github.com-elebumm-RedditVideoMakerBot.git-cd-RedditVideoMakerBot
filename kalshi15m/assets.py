"""Per-asset settings for Kalshi 15-minute series.

From `python -m kalshi15m.backtest` on Kalshi's own settled markets and
1-minute Yes bid/ask (2026-09-15 to 09-25; see docs/vixyvault-analysis.md, section 6).
Each vol_mult x min_edge pair was graded on the older half of 300 markets and
kept only if it also made money on the newer, held-out half, then rechecked on
700 older markets it had never seen.

verdict: "edge"  made money on unseen markets and beat Kalshi's Brier score
         "weak"  same, but the profit is within about one standard error of zero
         "none"  no setting made money on held-out markets; paper only, do not trade
For "none" assets the settings are left as they were; no pair held up.
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


PROFILES: dict[str, AssetProfile] = {
    "BTC": AssetProfile("KXBTC15M", "BTC-USD", 1.15, 0.03, "core", "none"),
    "ETH": AssetProfile("KXETH15M", "ETH-USD", 1.5, 0.04, "core", "none"),
    "SOL": AssetProfile("KXSOL15M", "SOL-USD", 1.0, 0.04, "core", "edge"),
    "XRP": AssetProfile("KXXRP15M", "XRP-USD", 1.5, 0.03, "core", "none"),
    "DOGE": AssetProfile("KXDOGE15M", "DOGE-USD", 1.5, 0.08, "thin", "none"),
    "NEAR": AssetProfile("KXNEAR15M", "NEAR-USD", 1.0, 0.07, "thin", "weak"),
}


def for_series(series: str) -> AssetProfile:
    for p in PROFILES.values():
        if p.series == series:
            return p
    raise KeyError(f"no profile for series {series!r}; known: {[p.series for p in PROFILES.values()]}")


def config_for(series: str, base: Config | None = None) -> Config:
    p = for_series(series)
    return replace(base or Config(), vol_mult=p.vol_mult, min_edge=p.min_edge)
