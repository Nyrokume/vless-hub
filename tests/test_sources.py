from pathlib import Path

from vlesshub.collect import load_config
from vlesshub.geo import normalize_country_code


def test_starter_sources_are_editable_yaml():
    root = Path(__file__).resolve().parents[1]
    settings, sources = load_config(root / "sources.yaml")
    assert settings.max_tcp_tests >= settings.max_proxy_tests >= 200
    assert settings.proxy_batch_size >= 8
    assert settings.proxy_timeout_sec <= 8
    assert settings.drop_after_failures >= 1
    names = {source.name for source in sources if source.enabled}
    assert "epodonios-vless" in names
    assert any(source.type == "telegram" and source.channel for source in sources if source.enabled)
    assert any(source.type == "subscription" and source.url.startswith("https://") for source in sources)
    tg = [source for source in sources if source.enabled and source.kind == "telegram-proxy"]
    assert any(source.type == "subscription" and "proxy" in source.url for source in tg)
    assert any(source.type == "telegram" and source.channel for source in tg)
    assert settings.max_tg_tests >= 1000
    assert settings.tg_concurrency >= 64
    assert settings.max_tg_links_per_source >= 2000
    assert "kort-mtproto" in names
    assert "zakky8-mtproto" in names
    assert "kort-socks5" in names
    assert "proxygenerator-socks" in names
    assert "tg-proxytelegram" in names
    assert "tg-irproxy" in names
    assert settings.confirm_rounds >= 2
    assert settings.min_working >= 40
    assert settings.vantage_checks >= 100
    assert settings.vantage_budget_sec >= 60
    enabled = [source for source in sources if source.enabled]
    assert len(enabled) >= 35
    subs = [source for source in enabled if source.type == "subscription" and source.kind != "telegram-proxy"]
    assert len(subs) >= 24
    assert "pawdroid-sub" in names
    assert "barry-far-sub1" in names
    disabled = {source.name for source in sources if not source.enabled}
    assert "coldwater-mix" in disabled
    assert "kwinshadow-mix" in disabled
    assert "argh94-socks5" in disabled
    assert "tg-proxy-mtg" in disabled
    for name in (
        "tg-mtproto-proxy",
        "tg-mtproxy-official",
        "tg-free-proxy-mtproto",
        "tg-socksproxy",
        "tg-tgsocks",
        "tg-proxymtproto-ru",
        "tg-mtproto-proxy-list",
    ):
        assert name in disabled
    assert normalize_country_code("de") == "DE"
    assert normalize_country_code("CLOUDFLARE") == ""
    assert normalize_country_code("FASTLY") == ""
