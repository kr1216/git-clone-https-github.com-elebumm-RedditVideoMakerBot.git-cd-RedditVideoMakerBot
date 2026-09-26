"""Fair-value model for Kalshi 15-minute "price ≥ strike" crypto markets.

Kalshi settles these markets on the average of the 60 one-second CF Benchmarks
RTI prints in the final minute before close. We model spot as arithmetic
Brownian motion (dollar vol per sqrt-second) over the remaining horizon and
compute P(settlement average >= strike) in closed form.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

SETTLE_WINDOW_S = 60


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def realized_vol_per_sec(samples: Sequence[tuple[float, float]]) -> float | None:
    """Dollar volatility per sqrt-second from (timestamp_s, price) samples.

    Returns None when there isn't enough data. Callers must treat None as
    "unknown", never substitute a placeholder.
    """
    if len(samples) < 3:
        return None
    sq, dt_total = 0.0, 0.0
    for (t0, p0), (t1, p1) in zip(samples, samples[1:]):
        dt = t1 - t0
        if dt <= 0:
            continue
        sq += (p1 - p0) ** 2
        dt_total += dt
    if dt_total <= 0:
        return None
    return math.sqrt(sq / dt_total)


@dataclass(frozen=True)
class FairValue:
    prob_yes: float  # P(settlement >= strike)
    mean: float  # expected settlement value
    stdev: float  # stdev of settlement value
    z: float  # (mean - strike) / stdev


def fair_prob_yes(
    spot: float,
    strike: float,
    seconds_left: float,
    vol_per_sec: float,
    observed_window_sum: float = 0.0,
    observed_window_n: int = 0,
) -> FairValue:
    """P(average of the final-minute prints >= strike).

    seconds_left: seconds until market close.
    observed_window_sum / observed_window_n: prints already inside the final
        60s window (only relevant when seconds_left <= 60).
    """
    sigma = max(vol_per_sec, 0.0)
    t = max(seconds_left, 0.0)

    if t > SETTLE_WINDOW_S:
        # Drift to window start, then average a Brownian path over 60s
        # (the average of BM over length L has variance L/3).
        var = sigma**2 * (t - SETTLE_WINDOW_S) + sigma**2 * SETTLE_WINDOW_S / 3.0
        mean = spot
    else:
        n_obs = min(observed_window_n, SETTLE_WINDOW_S)
        r = SETTLE_WINDOW_S - n_obs  # prints still to come
        mean = (observed_window_sum + r * spot) / SETTLE_WINDOW_S
        var = (r / SETTLE_WINDOW_S) ** 2 * sigma**2 * r / 3.0

    sd = math.sqrt(var)
    if sd == 0.0:
        p = 1.0 if mean >= strike else 0.0
        z = math.inf if mean >= strike else -math.inf
    else:
        z = (mean - strike) / sd
        p = norm_cdf(z)
    return FairValue(prob_yes=p, mean=mean, stdev=sd, z=z)


def blend_with_market(p_model: float, p_market: float, w: tuple[float, float, float]) -> float:
    """logit p = a*logit(model) + b*logit(market) + c.

    Kalshi's own price is about as accurate as the model; combining the two beats
    either alone (docs/model-research.md). Weights are fitted per asset.
    """
    a, b, c = w
    lg = lambda p: math.log(min(max(p, 1e-4), 1 - 1e-4) / (1 - min(max(p, 1e-4), 1 - 1e-4)))
    x = a * lg(p_model) + b * lg(p_market) + c
    return 1 / (1 + math.exp(-max(min(x, 50), -50)))


def kalshi_fee(price: float, contracts: int = 1, rate: float = 0.07) -> float:
    """Kalshi taker fee in dollars: ceil to the cent of rate*C*P*(1-P)."""
    raw = rate * contracts * price * (1.0 - price)
    return math.ceil(round(raw * 100, 9)) / 100.0


def expected_value(prob_win: float, price: float, contracts: int = 1) -> float:
    """EV in dollars of buying `contracts` at `price` (0-1) that pay $1 on win."""
    return contracts * (prob_win - price) - kalshi_fee(price, contracts)


def brier(prob: float, outcome: int) -> float:
    return (prob - outcome) ** 2
