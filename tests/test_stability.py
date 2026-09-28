from vlesshub.export import publish
from vlesshub.geo import prefer_country
from vlesshub.models import Settings
from vlesshub.parser import parse_vless
from vlesshub.stability import Stability
from vlesshub.stages import status_of


def test_stability_window_marks_a_rare_pass_unstable(tmp_path):
    path = tmp_path / "stability.json"
    history = Stability()
    for _ in range(6):
        history.note("abc", False)
    bits = history.note("abc", True)
    history.save(path)
    loaded = Stability.load(path, fetch_url=None)
    assert loaded.bits("abc") == bits
    assert status_of(True, bits) == "unstable"
    assert loaded.rate("abc") is not None
    assert loaded.rate("abc") < 0.7


def test_exit_country_beats_the_remark_flag():
    assert prefer_country("NL", "DE", "US") == ("NL", "exit")
    assert prefer_country("", "DE", "US") == ("US", "remark")
    assert prefer_country("", "DE", "") == ("DE", "host")
    assert prefer_country("cloudflare", "", "FI") == ("FI", "remark")


def test_default_subscription_skips_unstable(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    working = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@a.example:443?type=tcp&security=none#ok"
    )
    rare = parse_vless(
        "vless://22222222-2222-4222-8222-222222222222@b.example:443?type=tcp&security=none#rare"
    )
    assert working is not None and rare is not None
    working.country = "DE"
    working.status = "working"
    working.latency_ms = 80
    working.verified = "proxy"
    rare.country = "NL"
    rare.status = "unstable"
    rare.latency_ms = 40
    rare.verified = "proxy"
    out = tmp_path / "dist"
    publish(
        out_dir=out,
        site_dir=site,
        configs=[working],
        unstable=[rare],
        reports=[],
        collected=2,
        tcp_tested=2,
        tcp_ok=2,
        proxy_tested=2,
        proxy_ok=2,
        generated_at="2026-09-28T00:00:00Z",
        settings=Settings(top_sizes=[20]),
        rejections={"tcp_refused": 3, "no_data": 1, "timeout": 2},
    )
    default = (out / "sub" / "all.txt").read_text(encoding="utf-8")
    mixed = (out / "sub" / "with-unstable.txt").read_text(encoding="utf-8")
    assert "a.example" in default
    assert "b.example" not in default
    assert "a.example" in mixed and "b.example" in mixed
    assert mixed.index("b.example") < mixed.index("a.example")
    text = (out / "api" / "stats.json").read_text(encoding="utf-8")
    assert '"tcp_refused": 3' in text
    assert '"no_data": 1' in text
