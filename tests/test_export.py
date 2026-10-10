import base64
import json

from vlesshub.export import publish
from vlesshub.models import Settings, SourceReport
from vlesshub.parser import parse_vless


def test_publish_writes_subs_and_metadata(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("shell", encoding="utf-8")
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@de.example:443"
        "?type=tcp&security=reality&pbk=abc&sid=aa&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#orig"
    )
    assert cfg is not None
    cfg.country = "DE"
    cfg.country_name = "Germany"
    cfg.latency_ms = 120
    cfg.verified = "proxy"
    cfg.uptime = 1
    cfg.checks_ok = 3
    cfg.bits = "111"
    cfg.core = "xray"
    cfg.remark = "🚀 hello 😀"
    tcp_only = parse_vless(
        "vless://22222222-2222-4222-8222-222222222222@104.21.0.1:443?type=ws&security=tls&sni=cdn.example#edge"
    )
    assert tcp_only is not None
    tcp_only.country = "US"
    tcp_only.latency_ms = 0.3
    tcp_only.verified = "tcp"
    out = tmp_path / "dist"
    publish(
        out_dir=out,
        site_dir=site,
        configs=[cfg],
        unverified=[tcp_only],
        reports=[SourceReport(name="demo", url="https://example.invalid", ok=True, links=1, kept=1)],
        collected=1,
        tcp_tested=1,
        tcp_ok=1,
        proxy_tested=1,
        proxy_ok=1,
        generated_at="2026-09-28T00:00:00Z",
        settings=Settings(top_sizes=[20], clash_limit=10),
    )
    plain = (out / "sub" / "all.txt").read_text(encoding="utf-8")
    assert plain.startswith("#profile-title: V2Hub")
    best_file = (out / "sub" / "best.txt").read_text(encoding="utf-8")
    assert best_file.startswith("#profile-title: V2Hub — лучшие\n")
    assert "de.example" in best_file
    assert "\r" not in best_file
    assert "vless://" in plain
    assert "VLESS" in plain
    assert "hello" not in plain
    assert "🚀" not in plain
    assert "104.21.0.1" not in plain
    assert "0.3ms" not in plain
    verified = (out / "sub" / "verified.txt").read_text(encoding="utf-8")
    assert "de.example" in verified
    assert "104.21.0.1" not in verified
    unverified = (out / "sub" / "unverified.txt").read_text(encoding="utf-8")
    assert unverified.startswith("#profile-title: V2Hub — непроверенные")
    assert "104.21.0.1" in unverified
    assert "de.example" not in unverified
    assert "0.3ms" not in unverified
    assert "ms" not in unverified.split("vless://", 1)[-1]
    decoded = base64.b64decode((out / "sub" / "base64" / "all.txt").read_text()).decode()
    assert decoded.startswith("#profile-title: V2Hub\n")
    assert "vless://" in decoded
    assert "\r" not in decoded
    assert "\r" not in plain
    assert (out / "sub" / "country" / "DE.txt").is_file()
    assert (out / "sub" / "security" / "reality.txt").is_file()
    assert (out / "sub" / "transport" / "tcp.txt").is_file()
    assert (out / "sub" / "combo" / "DE-reality.txt").is_file()
    assert (out / "index.html").read_text(encoding="utf-8") == "shell"
    payload = json.loads((out / "api" / "configs.json").read_text(encoding="utf-8"))
    assert payload["configs"][0]["country"] == "DE"
    assert payload["configs"][0]["verified"] == "proxy"
    assert payload["unverified"][0]["host"] == "104.21.0.1"
    assert payload["unverified"][0]["latency_ms"] is None
    assert payload["unverified"][0]["verified"] == "tcp"
    stats = json.loads((out / "api" / "stats.json").read_text(encoding="utf-8"))
    assert stats["counts"]["published"] == 1
    assert stats["counts"]["unverified"] == 1
    assert stats["by_country"] == {"DE": 1}
    assert any(item["path"] == "sub/clash.yaml" for item in stats["subscriptions"])
    assert any(item["path"] == "sub/unverified.txt" for item in stats["subscriptions"])
    clash = (out / "sub" / "clash.yaml").read_text(encoding="utf-8")
    assert "reality-opts" in clash
    assert "104.21.0.1" not in clash
    singbox = json.loads((out / "sub" / "singbox.json").read_text(encoding="utf-8"))
    assert singbox["outbounds"][0]["tls"]["reality"]["public_key"] == "abc"
    hub = json.loads((out / "data" / "configs.json").read_text(encoding="utf-8"))
    assert hub["probe"] == "xray-http"
    assert hub["configs"][0]["country_code"] == "DE"
    assert hub["configs"][0]["verified"] == "proxy"
    assert hub["configs"][0]["bits"] == "111"
    assert hub["configs"][0]["core"] == "xray"
    assert hub["unverified"][0]["latency_ms"] is None
    assert hub["stats"]["published"] == 1
    legacy = (out / "data" / "subs" / "all.txt").read_text(encoding="utf-8")
    assert legacy.startswith("#profile-title: V2Hub")
    assert "de.example" in legacy
    assert "104.21.0.1" not in legacy
    assert (out / "data" / "subs" / "all.b64.txt").is_file()
    assert (out / "data" / "subs" / "clash.yaml").is_file()
    assert "de.example" in (out / "sub" / "with-unstable.txt").read_text(encoding="utf-8")
    assert hub["unstable"] == []
    assert "tcp_refused" in hub["stats"]["rejected"]
    version = json.loads((out / "data" / "version.json").read_text(encoding="utf-8"))
    assert version == {"generated_at": hub["generated_at"]}


def test_a_verified_config_is_not_also_written_as_unverified(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("shell", encoding="utf-8")
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@de.example:443"
        "?type=tcp&security=tls&sni=de.example#orig"
    )
    assert cfg is not None
    cfg.latency_ms = 180
    cfg.verified = "proxy"
    cfg.tested_at = "2026-09-28T08:00:00Z"
    cfg.country = "DE"
    out = tmp_path / "dist"
    publish(
        out_dir=out,
        site_dir=site,
        configs=[cfg],
        unverified=[cfg],
        reports=[],
        collected=1,
        tcp_tested=1,
        tcp_ok=1,
        proxy_tested=1,
        proxy_ok=1,
        generated_at="2026-09-28T10:00:00Z",
        settings=Settings(top_sizes=[20], clash_limit=0),
    )
    hub = json.loads((out / "data" / "configs.json").read_text(encoding="utf-8"))
    assert hub["unverified"] == []
    assert hub["configs"][0]["verified"] == "proxy"
    assert hub["configs"][0]["latency_ms"] == 180
    assert hub["configs"][0]["tested_at"] == "2026-09-28T08:00:00Z"
    assert cfg.verified == "proxy"
    assert cfg.latency_ms == 180
