from vlesshub.history import History
from vlesshub.parser import parse_vless
from vlesshub.rank import rank_published, select_candidates


def _cfg(host: str):
    cfg = parse_vless(
        f"vless://11111111-1111-4111-8111-111111111111@{host}:443?type=tcp&security=none#x"
    )
    assert cfg is not None
    return cfg


def test_select_prefers_stable_and_keeps_fresh_quota():
    history = History()
    stable = _cfg("stable.example")
    other = _cfg("other.example")
    fresh = _cfg("fresh.example")
    for _ in range(3):
        history.record(stable.fingerprint, ok=True, latency_ms=80)
    history.record(other.fingerprint, ok=True, latency_ms=400)
    history.record(other.fingerprint, ok=False, latency_ms=None)
    chosen = select_candidates([fresh, other, stable], history, limit=2, drop_after=4)
    assert stable in chosen
    assert len(chosen) == 2


def test_rank_puts_proxy_and_uptime_first():
    fast = _cfg("a.example")
    slow = _cfg("b.example")
    tcp = _cfg("c.example")
    fast.verified = "proxy"
    fast.latency_ms = 300
    fast.uptime = 0.5
    slow.verified = "proxy"
    slow.latency_ms = 100
    slow.uptime = 0.9
    tcp.verified = "tcp"
    tcp.latency_ms = 10
    tcp.uptime = 1
    ordered = rank_published([fast, tcp, slow])
    assert ordered[0] is slow
    assert ordered[-1] is tcp


def test_deprioritized_source_sorts_after_a_healthy_one():
    history = History()
    healthy = _cfg("healthy.example")
    healthy.sources = ["good"]
    tired = _cfg("tired.example")
    tired.sources = ["dead-feed"]
    chosen = select_candidates(
        [tired, healthy],
        history,
        limit=1,
        drop_after=4,
        deprioritized={"dead-feed"},
    )
    assert chosen == [healthy]


def test_select_ignores_sub_15ms_ema():
    history = History()
    fake = _cfg("fake.example")
    real = _cfg("real.example")
    history.record(fake.fingerprint, ok=True, latency_ms=0.3)
    history.record(real.fingerprint, ok=True, latency_ms=220)
    chosen = select_candidates([fake, real], history, limit=1, drop_after=4)
    assert chosen == [real]
