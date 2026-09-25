import math

from kalshi15m.assets import PROFILES, config_for, for_series
from kalshi15m.backtest import (
    SettledMarket, parse_coinbase_candles, parse_kalshi_candles, parse_settled,
    replay_market, summarize,
)
from kalshi15m.engine import Config

CLOSE = 1_800_000_900  # a quarter-hour boundary
OPEN = CLOSE - 900


def _spot(level):
    """Price parked at `level` with small $5 wiggles for the 40 min before and during the cycle."""
    return {OPEN + 60 * i: level + (5 if i % 2 else -5) for i in range(-40, 16)}


def _book(yes_bid, yes_ask):
    return {OPEN + 60 * m: (yes_bid, yes_ask) for m in range(1, 16)}


def test_profiles_feed_engine_config():
    cfg = config_for("KXBTC15M")
    assert cfg.vol_mult == PROFILES["BTC"].vol_mult and cfg.min_edge == PROFILES["BTC"].min_edge
    assert config_for("KXDOGE15M").min_edge > cfg.min_edge
    assert for_series("KXSOL15M").product == "SOL-USD"


def test_parse_formats():
    k = parse_kalshi_candles({"candlesticks": [
        {"end_period_ts": 1, "yes_bid": {"close": 40}, "yes_ask": {"close": 42}},
        {"end_period_ts": 2, "yes_bid": {"close_dollars": "0.9500"}, "yes_ask": {"close_dollars": "0.9700"}},
    ]})
    assert k[1] == (0.40, 0.42) and k[2] == (0.95, 0.97)
    assert parse_coinbase_candles([[1000, 1, 2, 1.5, 1.7, 9]]) == {1060: 1.7}
    m = parse_settled({"ticker": "T", "floor_strike": 100, "result": "yes", "close_time": "2027-01-15T08:15:00Z"})
    assert m.outcome == 1 and m.strike == 100.0
    assert parse_settled({"ticker": "T", "result": "yes", "close_time": "2027-01-15T08:15:00Z"}) is None


def test_buys_when_book_lags_and_scores_pnl():
    # Spot jumps $300 above the strike but the book still quotes Yes at 55c.
    m = SettledMarket("T", 100_000.0, CLOSE, outcome=1)
    r = replay_market(m, _book(0.53, 0.55), _spot(100_300), Config(vol_mult=1.0))
    assert r.action == "BUY_YES" and r.price == 0.55 and r.minute == 2
    assert math.isclose(r.pnl, 1 - 0.55 - 0.02)
    s = summarize([r])
    assert s["trades"] == 1 and s["brier_model"] < s["brier_market"]


def test_skips_when_book_already_agrees():
    m = SettledMarket("T", 100_000.0, CLOSE, outcome=1)
    r = replay_market(m, _book(0.97, 0.99), _spot(100_300), Config(vol_mult=1.0))
    assert r.action == "SKIP" and r.pnl == 0.0
    assert summarize([r])["trades"] == 0
