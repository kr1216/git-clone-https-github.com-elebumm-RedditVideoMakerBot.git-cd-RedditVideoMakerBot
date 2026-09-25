"""Decision engine: fair value vs. the live Kalshi book, gated like VIXY's lock.

Unlike VIXY, the headline output is *edge after fees*, not a hit-rate. A call
that is 97% likely but costs 98¢ is a SKIP.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from .model import FairValue, expected_value, fair_prob_yes


@dataclass(frozen=True)
class MarketSnapshot:
    ticker: str
    strike: float
    close_ts: float  # unix seconds
    yes_ask: float | None  # dollars, 0-1
    no_ask: float | None
    fetched_ts: float


@dataclass(frozen=True)
class Config:
    min_edge: float = 0.03  # dollars/contract after fees
    max_price: float = 0.92  # never pay more than this
    earliest_s_left: float = 13 * 60  # don't act before 2 minutes in
    latest_s_left: float = 20  # don't act in the last seconds
    max_spot_age_s: float = 5.0
    max_book_age_s: float = 5.0
    stable_readings: int = 3  # same side N ticks in a row
    vol_mult: float = 1.0  # widen realized vol for jumps; see kalshi15m/assets.py


@dataclass(frozen=True)
class Decision:
    action: str  # "BUY_YES" | "BUY_NO" | "SKIP"
    side: str  # "UP" | "DOWN"
    fair: FairValue | None
    edge_yes: float | None
    edge_no: float | None
    reasons: tuple[str, ...]

    @property
    def reversal_risk(self) -> float | None:
        """Model probability that the currently favoured side loses."""
        if self.fair is None:
            return None
        p = self.fair.prob_yes
        return 1.0 - p if self.side == "UP" else p


@dataclass
class Engine:
    cfg: Config = field(default_factory=Config)
    _history: deque = field(default_factory=lambda: deque(maxlen=10))

    def evaluate(
        self,
        now: float,
        mkt: MarketSnapshot,
        spot: float | None,
        spot_ts: float | None,
        vol_per_sec: float | None,
        window_sum: float = 0.0,
        window_n: int = 0,
    ) -> Decision:
        cfg = self.cfg
        reasons: list[str] = []
        s_left = mkt.close_ts - now

        if spot is None or spot_ts is None or now - spot_ts > cfg.max_spot_age_s:
            reasons.append("spot feed stale or missing")
        if now - mkt.fetched_ts > cfg.max_book_age_s:
            reasons.append("Kalshi book stale")
        if vol_per_sec is None:
            reasons.append("volatility not measured")
        if reasons:
            self._history.clear()
            return Decision("SKIP", "UP", None, None, None, tuple(reasons))

        fair = fair_prob_yes(
            spot, mkt.strike, s_left, vol_per_sec * cfg.vol_mult, window_sum, window_n
        )
        side = "UP" if fair.prob_yes >= 0.5 else "DOWN"
        self._history.append(side)

        edge_yes = (
            expected_value(fair.prob_yes, mkt.yes_ask) if mkt.yes_ask is not None else None
        )
        edge_no = (
            expected_value(1 - fair.prob_yes, mkt.no_ask) if mkt.no_ask is not None else None
        )

        if s_left > cfg.earliest_s_left:
            reasons.append(f"too early ({s_left:.0f}s left)")
        if s_left < cfg.latest_s_left:
            reasons.append(f"too late ({s_left:.0f}s left)")
        recent = list(self._history)[-cfg.stable_readings :]
        if len(recent) < cfg.stable_readings or len(set(recent)) != 1:
            reasons.append("side not stable")

        best = None
        for action, edge, price in (
            ("BUY_YES", edge_yes, mkt.yes_ask),
            ("BUY_NO", edge_no, mkt.no_ask),
        ):
            if edge is None or price is None:
                continue
            if price > cfg.max_price:
                continue
            if edge >= cfg.min_edge and (best is None or edge > best[1]):
                best = (action, edge)
        if best is None:
            reasons.append("no edge after fees at current prices")

        if reasons:
            return Decision("SKIP", side, fair, edge_yes, edge_no, tuple(reasons))
        return Decision(best[0], side, fair, edge_yes, edge_no, ())
