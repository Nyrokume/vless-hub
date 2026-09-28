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
    for name in (
        "taheri-vless",
        "taheri-ss",
        "taheri-trojan",
        "radikal-trojan",
        "radikal-hysteria2",
        "ermaozi-mix",
        "kamaji-mix",
        "mahdibland-ss",
        "proxifly-socks5",
        "speedx-socks5",
    ):
        assert name in names
    proxifly = next(source for source in sources if source.name == "proxifly-socks5")
    assert proxifly.kind == "telegram-proxy" and proxifly.limit == 80
    speedx = next(source for source in sources if source.name == "speedx-socks5")
    assert speedx.kind == "telegram-proxy"
    assert any(source.type == "telegram" and source.channel for source in sources if source.enabled)
    assert any(source.type == "subscription" and source.url.startswith("https://") for source in sources)
    tg = [source for source in sources if source.enabled and source.kind == "telegram-proxy"]
    assert any(source.type == "subscription" and "proxy" in source.url for source in tg)
    assert any(source.type == "telegram" and source.channel for source in tg)
    assert settings.max_tg_tests >= 40
    assert normalize_country_code("de") == "DE"
    assert normalize_country_code("CLOUDFLARE") == ""
    assert normalize_country_code("FASTLY") == ""
