"""Model-improvement experiments on Kalshi's settled 15-minute markets.

    PYTHONPATH=. python -m research.experiments SOL NEAR BTC ...

Every parameter is chosen on the older half of the markets and reported on the
newer, held-out half. Needs the 1000-market caches from
`python -m kalshi15m.backtest --series <SERIES> --markets 1000`.
"""

from __future__ import annotations

import math
import statistics as st
import sys

from kalshi15m.assets import PROFILES

from .evaluate import brier, fmt, gbm_prob, logloss, pnl_stats, split, trades  # noqa: F401
from .features import Row, rows_for

EDGES = (0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08)
MIN_TRADES = 60  # in-sample trades a setting needs before it can be chosen


def logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-max(min(x, 50), -50)))


def fit_logistic(xs: list[list[float]], ys: list[int], l2: float = 1e-3, iters: int = 25) -> list[float]:
    """Newton's method for logistic regression (small, dense, pure Python)."""
    k = len(xs[0])
    w = [0.0] * k
    for _ in range(iters):
        g = [0.0] * k
        h = [[0.0] * k for _ in range(k)]
        for x, y in zip(xs, ys):
            p = sigmoid(sum(a * b for a, b in zip(w, x)))
            d = p - y
            s = p * (1 - p)
            for i in range(k):
                g[i] += d * x[i]
                for j in range(k):
                    h[i][j] += s * x[i] * x[j]
        for i in range(k):
            g[i] += l2 * w[i]
            h[i][i] += l2
        w = [a - b for a, b in zip(w, _solve(h, g))]
    return w


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        for r in range(n):
            if r != c and m[c][c]:
                f = m[r][c] / m[c][c]
                m[r] = [x - f * y for x, y in zip(m[r], m[c])]
    return [m[i][n] / m[i][i] if m[i][i] else 0.0 for i in range(n)]


def choose_edge(train: list[Row], f, **kw) -> tuple[float, dict]:
    """min_edge with the best in-sample P&L per contract among those with enough trades."""
    best = None
    for e in EDGES:
        s = pnl_stats(trades(train, f, e, **kw))
        if s["n"] >= MIN_TRADES and (best is None or s["c"] > best[1]["c"]):
            best = (e, s)
    return best or (EDGES[0], pnl_stats(trades(train, f, EDGES[0], **kw)))


def model(vm: float = 1.0, lookback: int = 30, basis_shift: bool = False, basis_sd: float = 0.0):
    def f(r: Row):
        v = r.vols.get(lookback)
        if not v:
            return None
        spot = r.spot - (r.basis or 0.0) if basis_shift else r.spot
        t = max(r.s_left, 0.0)
        var = (v * vm) ** 2 * (max(t - 60, 0) + min(t, 60) / 3) + basis_sd ** 2
        return gbm_prob(spot, r.strike, 1e9, 1.0) if var <= 0 else _p(spot, r.strike, var)
    return f


def _p(spot, strike, var):
    from kalshi15m.model import norm_cdf
    return norm_cdf((spot - strike) / math.sqrt(var))


def run(asset: str, out=print) -> dict:
    """Fit every parameter on the older half; report the newer half.

    Accuracy (log loss, Brier) is the primary grade: it is far less noisy than P&L.
    P&L is shown at fixed 3c and 6c minimum edges so no threshold is cherry-picked.
    All models are scored on the same rows (those with a Kalshi mid, basis and vol).
    """
    rows = [r for r in rows_for(asset) if r.mid is not None and r.basis is not None
            and all(r.vols.get(k) for k in (10, 15, 30, 60)) and r.momentum is not None]
    train, test = split(rows)
    prof = PROFILES[asset]
    res = {}

    def report(name, f):
        s3, s6 = (pnl_stats(trades(test, f, e)) for e in (0.03, 0.06))
        res[name] = {"ll": logloss(test, f), "brier": brier(test, f), "p3": s3, "p6": s6}
        out(f"  {name:<36} logloss {res[name]['ll']:.4f}  Brier {res[name]['brier']:.4f}"
            f" | 3c {fmt(s3)} | 6c {fmt(s6)}")

    out(f"\n{asset}: {len({r.ticker for r in rows})} markets, {len(rows)} market-minutes; "
        f"held-out half from {len({r.ticker for r in test})} markets")
    report("Kalshi mid (the market itself)", lambda r: r.mid)
    report(f"E0 current profile (vol x{prof.vol_mult})", model(prof.vol_mult))

    vms = [0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5]
    vm = min(vms, key=lambda v: logloss(train, model(v)))
    report(f"E1 vol x{vm} (fit by log loss)", model(vm))

    lb = min((10, 15, 30, 60), key=lambda k: logloss(train, model(vm, k)))
    report(f"E2 + lookback {lb}m", model(vm, lb))

    shift = logloss(train, model(vm, lb, basis_shift=True)) < logloss(train, model(vm, lb))
    report(f"E3 basis shift ({'kept' if shift else 'rejected'} in-sample)", model(vm, lb, basis_shift=True))

    bsd = [r.basis for r in train if r.minute == 2]
    bsd0 = st.pstdev(bsd)
    k = min((0.0, 0.5, 1.0, 1.5, 2.0), key=lambda k: logloss(train, model(vm, lb, shift, k * bsd0)))
    base = model(vm, lb, shift, k * bsd0)
    report(f"E4 + basis noise {k}x (${k*bsd0:.4g})", base)

    tr = [(r, base(r)) for r in train]
    w = fit_logistic([[logit(p), logit(r.mid), 1.0] for r, p in tr], [r.outcome for r, _ in tr])
    blend = lambda r: sigmoid(w[0] * logit(base(r)) + w[1] * logit(r.mid) + w[2])
    report(f"E5 blend {w[0]:.2f}*model + {w[1]:.2f}*Kalshi", blend)

    for mp in (0.1, 0.2, 0.3):
        s3 = pnl_stats(trades(test, blend, 0.03, min_price=mp))
        s6 = pnl_stats(trades(test, blend, 0.06, min_price=mp))
        out(f"  E6 blend, skip prices < {mp:.1f}{'':<14} | 3c {fmt(s3)} | 6c {fmt(s6)}")
        res[f"E6 min price {mp}"] = {"p3": s3, "p6": s6}

    feat = lambda r: [logit(base(r)), logit(r.mid), r.momentum / (r.vols[lb] * math.sqrt(300)), 1.0]
    w7 = fit_logistic([feat(r) for r in train], [r.outcome for r in train])
    report(f"E7 blend + momentum ({w7[2]:+.3f})", lambda r: sigmoid(sum(a * b for a, b in zip(w7, feat(r)))))
    res["params"] = {"vm": vm, "lb": lb, "shift": shift, "basis_k": k, "basis_sd": bsd0, "blend": w, "mom": w7}
    return res


if __name__ == "__main__":
    for a in sys.argv[1:] or ["SOL", "NEAR"]:
        run(a)
