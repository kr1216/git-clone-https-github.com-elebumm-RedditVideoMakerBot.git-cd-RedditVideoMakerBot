import math

from kalshi15m.assets import PROFILES, config_for, for_series
from kalshi15m.backtest import (
    SettledMarket, parse_coinbase_candles, parse_kalshi_candles, parse_settled,
    replay_market, split_halves, summarize, sweep,
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
    assert cfg.blend == PROFILES["BTC"].blend and cfg.blend is not None
    assert for_series("KXSOL15M").product == "SOL-USD"
    assert {p.verdict for p in PROFILES.values()} <= {"edge", "weak", "none"}


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


def test_requests_send_a_named_user_agent(monkeypatch):
    # Coinbase's Cloudflare returns 403 (error 1010) to urllib's default agent.
    import io
    from kalshi15m import feeds

    seen = {}

    def fake_urlopen(req, timeout):
        seen["ua"] = req.get_header("User-agent")
        return io.StringIO("{}")

    monkeypatch.setattr(feeds.urllib.request, "urlopen", fake_urlopen)
    assert feeds._get_json("https://example.test/x") == {}
    assert seen["ua"] and "Python-urllib" not in seen["ua"]


def test_split_holds_out_the_newer_half():
    ms = [SettledMarket(f"T{i}", 100.0, CLOSE + 900 * i, 1) for i in (3, 0, 2, 1)]
    old, new = split_halves(ms)
    assert [m.ticker for m in old] == ["T0", "T1"] and [m.ticker for m in new] == ["T2", "T3"]


def test_sweep_grades_every_pair_on_both_halves():
    ms = [SettledMarket(f"T{i}", 100_000.0, CLOSE, 1) for i in range(4)]
    books = {m.ticker: _book(0.53, 0.55) for m in ms}
    rows = sweep(ms, books, _spot(100_300), Config(), min_trades=1)
    assert len(rows) == 28
    assert all(r["train"]["markets"] == 2 and r["test"]["markets"] == 2 for r in rows)
    assert rows[0]["train"]["pnl_per_trade"] >= rows[-1]["train"]["pnl_per_trade"]


def test_live_loop_measures_vol_like_the_backtest(monkeypatch):
    import kalshi15m.__main__ as live

    now = CLOSE + 30  # mid-minute: only completed minutes count
    closes = {CLOSE - 60 * i: 100.0 + (1 if i % 2 else -1) for i in range(35)}
    asked = {}

    def fake_fetch(product, start, end):
        asked.update(product=product, start=start, end=end)
        return closes

    monkeypatch.setattr(live, "fetch_spot", fake_fetch)
    v = live.candle_vol("SOL-USD", now)
    assert asked["end"] == CLOSE and asked["product"] == "SOL-USD"
    assert math.isclose(v, 2 / math.sqrt(60))  # $2 per 1-minute step


def test_score_takes_first_buy_per_settled_market():
    from kalshi15m.score import score

    rows = [
        {"ts": 60, "ticker": "A", "fair_up": 0.8, "yes_ask": 0.60, "no_ask": 0.42, "action": "SKIP"},
        {"ts": 62, "ticker": "A", "fair_up": 0.8, "yes_ask": 0.60, "no_ask": 0.42, "action": "BUY_YES"},
        {"ts": 124, "ticker": "A", "fair_up": 0.2, "yes_ask": 0.30, "no_ask": 0.72, "action": "BUY_NO"},
        {"ts": 60, "ticker": "OPEN", "fair_up": 0.5, "yes_ask": 0.5, "no_ask": 0.5, "action": "BUY_YES"},
    ]
    [r] = score(rows, {"A": 1})
    assert r.action == "BUY_YES" and r.price == 0.60
    assert math.isclose(r.pnl, 1 - 0.60 - 0.02)
    assert len(r.model_sq) == 2  # one tick per minute: minutes 1 and 2


def test_blend_pulls_the_model_toward_kalshi():
    from kalshi15m.model import blend_with_market

    assert math.isclose(blend_with_market(0.8, 0.3, (1.0, 0.0, 0.0)), 0.8)
    assert math.isclose(blend_with_market(0.8, 0.3, (0.0, 1.0, 0.0)), 0.3)
    p = blend_with_market(0.8, 0.3, (0.5, 0.5, 0.0))
    assert 0.3 < p < 0.8


def test_engine_blends_and_needs_both_sides_of_the_book():
    from kalshi15m.engine import Engine, MarketSnapshot

    eng = Engine(Config(stable_readings=1, blend=(0.5, 0.5, 0.0)))
    now = CLOSE - 600
    snap = MarketSnapshot("T", 100_000.0, CLOSE, 0.55, 0.47, now)
    d = eng.evaluate(now, snap, 100_300.0, now, 5.0)
    assert d.model_prob is not None and d.fair.prob_yes < d.model_prob  # market mid 0.54 pulls it down
    d = eng.evaluate(now, MarketSnapshot("T", 100_000.0, CLOSE, 0.55, None, now), 100_300.0, now, 5.0)
    assert d.action == "SKIP" and "no Kalshi mid to blend with" in d.reasons
