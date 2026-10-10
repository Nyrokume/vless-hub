from vlesshub.parser import parse_any, parse_vless
from vlesshub.rank import apply_best, load_best, rank_published, save_best, select_best
from vlesshub.vantage import _sample


def _cfg(host: str, uuid: str = "11111111-1111-4111-8111-111111111111", security: str = "none"):
    cfg = parse_vless(
        f"vless://{uuid}@{host}:443?type=tcp&security={security}&fp=chrome#x"
    )
    assert cfg is not None
    cfg.verified = "proxy"
    cfg.latency_ms = 200
    return cfg


def test_rank_puts_a_russia_443_ahead_of_a_faster_unchecked_core():
    ready = _cfg("ready.example", security="tls")
    ready.vantage = "ru"
    ready.latency_ms = 800
    ready.bits = "1"
    core = _cfg("core.example")
    core.latency_ms = 40
    core.bits = "111"
    ordered = rank_published([core, ready])
    assert ordered[0] is ready


def test_best_prefers_distinct_hosts_on_443_and_skips_hysteria():
    slow = _cfg("slow.example", uuid="11111111-1111-4111-8111-111111111112", security="tls")
    slow.vantage = "multi"
    slow.bits = "111"
    slow.latency_ms = 300
    same = _cfg("slow.example", uuid="11111111-1111-4111-8111-111111111113", security="tls")
    same.vantage = "ru"
    same.latency_ms = 50
    other = _cfg("other.example", uuid="11111111-1111-4111-8111-111111111114", security="tls")
    other.vantage = "ru"
    other.bits = "1"
    other.latency_ms = 90
    plain = _cfg("plain.example", uuid="11111111-1111-4111-8111-111111111115")
    plain.latency_ms = 20
    plain.bits = "111"
    hy2 = parse_any("hysteria2://secret@hy2.example:443?insecure=1#x")
    assert hy2 is not None
    hy2.verified = "proxy"
    hy2.latency_ms = 10
    chosen = select_best([plain, hy2, same, other, slow], limit=2)
    assert [cfg.host for cfg in chosen] == ["slow.example", "other.example"]
    assert hy2 not in chosen
    assert plain not in chosen


def test_best_still_returns_one_when_nothing_opened_from_russia():
    only = _cfg("only.example")
    only.port = 2053
    only.latency_ms = 400
    assert select_best([only], limit=12) == [only]


def test_empty_run_restores_the_last_best_except_a_russia_refusal(tmp_path):
    kept = _cfg("kept.example", security="tls")
    kept.vantage = "ru"
    kept.latency_ms = 100
    kept.bits = "111"
    closed = _cfg("closed.example", uuid="22222222-2222-4222-8222-222222222222", security="tls")
    closed.vantage = "ru"
    closed.latency_ms = 110
    path = tmp_path / "state" / "best.json"
    save_best(path, [kept, closed], "2026-10-10T00:00:00Z")
    hy2 = parse_any("hysteria2://secret@hy2.example:443?insecure=1#x")
    assert hy2 is not None
    hy2.verified = "proxy"
    hy2.latency_ms = 50
    published, best = apply_best([hy2], path, {(closed.host, closed.port)}, "2026-10-10T01:00:00Z")
    assert any(cfg.host == "kept.example" for cfg in published)
    assert any(cfg.host == "kept.example" for cfg in best)
    assert all(cfg.host != "closed.example" for cfg in published + best)
    again = load_best(path, set())
    assert [cfg.host for cfg in again] == ["kept.example"]


def test_a_live_config_is_not_replaced_by_the_saved_list(tmp_path):
    current = _cfg("now.example", security="tls")
    current.latency_ms = 80
    old = _cfg("old.example", uuid="33333333-3333-4333-8333-333333333333", security="tls")
    old.vantage = "ru"
    path = tmp_path / "best.json"
    save_best(path, [old], "2026-10-10T00:00:00Z")
    published, best = apply_best([current], path, set(), "2026-10-10T01:00:00Z")
    assert [cfg.host for cfg in published] == ["now.example"]
    assert [cfg.host for cfg in best] == ["now.example"]


def test_missing_fallback_does_not_create_an_empty_file(tmp_path):
    path = tmp_path / "best.json"
    published, best = apply_best([], path, set(), "2026-10-10T00:00:00Z")
    assert published == [] and best == []
    assert not path.exists()


def test_vantage_sample_spends_the_budget_on_443_reality_first():
    late = _cfg("late.example", security="reality")
    late.port = 8443
    late.country = "DE"
    other = _cfg("other.example")
    other.country = "US"
    early = _cfg("early.example", uuid="44444444-4444-4444-8444-444444444444", security="reality")
    early.country = "NL"
    picked = _sample([late, other, early], 1)
    assert [cfg.host for cfg in picked] == ["early.example"]
    second = _cfg("second.example", uuid="55555555-5555-4555-8555-555555555555", security="tls")
    second.country = "DE"
    both = _sample([other, second, early], 2)
    assert {cfg.host for cfg in both} == {"early.example", "second.example"}
