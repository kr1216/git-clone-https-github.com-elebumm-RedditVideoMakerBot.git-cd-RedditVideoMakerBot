import math
import random

from kalshi15m.engine import Config, Engine, MarketSnapshot
from kalshi15m.feeds import parse_market
from kalshi15m.model import expected_value, fair_prob_yes, kalshi_fee, realized_vol_per_sec


def test_at_the_money_is_half():
    assert math.isclose(fair_prob_yes(100.0, 100.0, 600, 0.5).prob_yes, 0.5)


def test_final_window_variance_is_one_third():
    # With exactly 60s left, the settlement average has variance sigma^2*60/3.
    fv = fair_prob_yes(100.0, 100.0, 60, 1.0)
    assert math.isclose(fv.stdev, math.sqrt(20.0))


def test_fully_observed_window_is_deterministic():
    fv = fair_prob_yes(0.0, 100.0, 0, 5.0, observed_window_sum=60 * 101.0, observed_window_n=60)
    assert fv.prob_yes == 1.0


def test_monte_carlo_agrees_with_closed_form():
    rng = random.Random(7)
    spot, strike, t, sigma = 86_560.0, 86_600.0, 180, 3.0
    wins, n = 0, 4000
    for _ in range(n):
        p = spot
        for _ in range(t - 60):
            p += rng.gauss(0, sigma)
        acc = 0.0
        for _ in range(60):
            p += rng.gauss(0, sigma)
            acc += p
        wins += acc / 60 >= strike
    mc = wins / n
    cf = fair_prob_yes(spot, strike, t, sigma).prob_yes
    assert abs(mc - cf) < 0.03


def test_fee_and_ev_at_extreme_price():
    assert kalshi_fee(0.97) == 0.01
    assert kalshi_fee(0.50) == 0.02
    # The VIXY situation: a 90% hit rate bought at 97c loses money.
    assert expected_value(0.90, 0.97) < 0


def test_realized_vol():
    samples = [(float(i), 100.0 + (1 if i % 2 else 0)) for i in range(11)]
    assert math.isclose(realized_vol_per_sec(samples), 1.0)
    assert realized_vol_per_sec([(0.0, 1.0)]) is None


def _mkt(now, yes_ask, no_ask, s_left=300):
    return MarketSnapshot("KXBTC15M-TEST", 100.0, now + s_left, yes_ask, no_ask, now)


def test_skip_when_market_already_prices_it():
    eng, now = Engine(), 1_000.0
    for i in range(3):
        d = eng.evaluate(now + i, _mkt(now + i, 0.98, 0.03), 110.0, now + i, 0.2)
    assert d.side == "UP"
    assert d.action == "SKIP"
    assert "no edge after fees at current prices" in d.reasons


def test_buy_when_book_lags_spot():
    eng, now = Engine(), 1_000.0
    for i in range(3):
        d = eng.evaluate(now + i, _mkt(now + i, 0.60, 0.42), 110.0, now + i, 0.2)
    assert d.action == "BUY_YES"
    assert d.reversal_risk < 0.01


def test_stale_or_unmeasured_inputs_skip():
    eng, now = Engine(), 1_000.0
    assert eng.evaluate(now, _mkt(now, 0.5, 0.5), 110.0, now - 60, 1.0).action == "SKIP"
    d = eng.evaluate(now, _mkt(now, 0.5, 0.5), 110.0, now, None)
    assert "volatility not measured" in d.reasons


def test_requires_stable_side():
    eng, now = Engine(Config(stable_readings=3)), 1_000.0
    d = eng.evaluate(now, _mkt(now, 0.60, 0.42), 110.0, now, 1.0)
    assert "side not stable" in d.reasons


def test_parse_market_both_price_formats():
    base = {"ticker": "T", "floor_strike": 86353.73, "close_time": "2026-09-23T16:15:00Z"}
    a = parse_market({**base, "yes_ask": 97, "yes_bid": 96}, 0.0)
    b = parse_market({**base, "yes_ask_dollars": "0.9700", "no_ask_dollars": "0.0400"}, 0.0)
    assert a.yes_ask == 0.97 and a.no_ask == 0.04
    assert b.yes_ask == 0.97 and b.no_ask == 0.04
    assert parse_market({"ticker": "T", "close_time": base["close_time"]}, 0.0) is None
