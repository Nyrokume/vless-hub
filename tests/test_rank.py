from vlesshub.history import History
from vlesshub.parser import parse_any, parse_vless
from vlesshub.rank import carry_verified, mix_proxy_targets, rank_published, select_candidates


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


def test_rank_sorts_verified_configs_by_ping():
    fast = _cfg("a.example")
    slow = _cfg("b.example")
    tcp = _cfg("c.example")
    fast.verified = "proxy"
    fast.latency_ms = 90
    fast.uptime = 0.2
    slow.verified = "proxy"
    slow.latency_ms = 400
    slow.uptime = 1
    tcp.verified = "tcp"
    tcp.latency_ms = 10
    tcp.uptime = 1
    ordered = rank_published([slow, tcp, fast])
    assert ordered[0] is fast
    assert ordered[1] is slow
    assert ordered[-1] is tcp


def test_untested_configs_are_chosen_before_recent_failures():
    history = History()
    failed = _cfg("failed.example")
    history.record(failed.fingerprint, ok=False, latency_ms=None)
    fresh = [_cfg(f"new{index}.example") for index in range(5)]
    chosen = select_candidates([failed, *fresh], history, limit=3, drop_after=4)
    assert failed not in chosen
    assert len(chosen) == 3
    assert all(cfg in fresh for cfg in chosen)


def test_carry_keeps_a_previous_proxy_success_until_it_fails():
    history = History()
    kept = _cfg("kept.example")
    dead = _cfg("dead.example")
    fresh = _cfg("fresh.example")
    history.record(kept.fingerprint, ok=True, latency_ms=180)
    history.record(dead.fingerprint, ok=True, latency_ms=200)
    history.record(dead.fingerprint, ok=False, latency_ms=None)
    carried = carry_verified([dead, fresh, kept], history, set())
    assert carried == [kept]
    assert kept.verified == "proxy"
    assert kept.latency_ms == 180
    assert kept.tested_at == history.get(kept.fingerprint)["last_ok"]


def test_hysteria2_gets_proxy_slots_ahead_of_a_full_tcp_pool():
    history = History()
    tcp_ok = [_cfg(f"tcp{i}.example") for i in range(30)]
    hy2 = parse_any("hysteria2://secret@hy2.example:443?insecure=1#x")
    assert hy2 is not None
    chosen = mix_proxy_targets(tcp_ok, [hy2], history, limit=10, drop_after=4)
    assert hy2 in chosen
    assert len(chosen) == 10


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


def test_long_dead_streak_leaves_the_pool():
    history = History()
    dead = _cfg("dead.example")
    fresh = _cfg("fresh.example")
    for _ in range(4):
        history.record(dead.fingerprint, ok=False, latency_ms=None)
    chosen = select_candidates([dead, fresh], history, limit=5, drop_after=4)
    assert chosen == [fresh]


def test_known_good_is_retested_before_a_new_candidate():
    history = History()
    old = _cfg("old.example")
    fresh = _cfg("fresh.example")
    history.record(old.fingerprint, ok=True, latency_ms=180)
    chosen = select_candidates([fresh, old], history, limit=1, drop_after=4)
    assert chosen == [old]


def test_carry_drops_a_pass_older_than_six_hours():
    history = History()
    aged = _cfg("aged.example")
    history.record(aged.fingerprint, ok=True, latency_ms=180)
    history.entries[aged.fingerprint]["last_ok"] = "2020-01-01T00:00:00Z"
    assert carry_verified([aged], history, set()) == []


def test_select_ignores_sub_15ms_ema():
    history = History()
    fake = _cfg("fake.example")
    real = _cfg("real.example")
    history.record(fake.fingerprint, ok=True, latency_ms=0.3)
    history.record(real.fingerprint, ok=True, latency_ms=220)
    chosen = select_candidates([fake, real], history, limit=1, drop_after=4)
    assert chosen == [real]
