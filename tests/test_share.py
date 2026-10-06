"""The bytes in the share link are the bytes the cores are given."""

import json
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from vlesshub.export import publish
from vlesshub.models import Settings
from vlesshub.parser import build_uri, exported_config, fits_popular_clients, parse_vless
from vlesshub.probe import build_mihomo_batch, build_outbound

ROOT = Path(__file__).resolve().parents[1]
UUID = "11111111-1111-4111-8111-111111111111"


def _query(uri: str) -> dict[str, str]:
    parsed = urlsplit(uri)
    pairs = parse_qs(parsed.query, keep_blank_values=True)
    return {key: values[0] for key, values in pairs.items()}


def test_reality_link_carries_the_fingerprint_the_core_uses():
    cfg = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=abc&sid=aa"
        "&sni=www.microsoft.com&flow=xtls-rprx-vision#r"
    )
    assert cfg is not None
    assert cfg.fp == "chrome"
    uri = build_uri(cfg, remark="🇩🇪 Германия")
    query = _query(uri)
    assert query["fp"] == "chrome"
    assert query["pbk"] == "abc"
    assert query["sid"] == "aa"
    assert query["sni"] == "www.microsoft.com"
    assert query["flow"] == "xtls-rprx-vision"
    assert unquote(uri.split("#", 1)[1]) == "🇩🇪 Германия"
    reality = build_outbound(cfg)["streamSettings"]["realitySettings"]
    assert reality["fingerprint"] == query["fp"]
    again = exported_config(cfg)
    assert again is not None
    assert _query(again.raw)["fp"] == "chrome"


def test_rare_fingerprint_and_old_flow_are_rewritten_before_export():
    rare = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=abc&sid=aa"
        "&sni=www.microsoft.com&fp=qq&flow=xtls-rprx-vision-udp443#r"
    )
    assert rare is not None
    assert rare.fp == "chrome"
    assert rare.flow == "xtls-rprx-vision"
    assert "fp=qq" not in build_uri(rare)
    assert "udp443" not in build_uri(rare)


def test_http2_is_exported_as_type_http_and_host_comes_from_sni():
    cfg = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=h2&security=tls&sni=cdn.example&path=%2Fh%2Fv#h"
    )
    assert cfg is not None
    assert cfg.network == "h2"
    assert cfg.host_header == "cdn.example"
    uri = build_uri(cfg)
    query = _query(uri)
    assert query["type"] == "http"
    assert query["path"] == "/h/v"
    assert query["host"] == "cdn.example"
    assert "type=h2" not in uri
    again = parse_vless(uri)
    assert again is not None and again.network == "h2" and again.host_header == "cdn.example"


def test_path_service_and_alpn_are_encoded_once():
    cfg = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=ws&security=tls&sni=cdn.example"
        "&path=%2Fvless%2F&alpn=h2%2Chttp%2F1.1#имя"
    )
    assert cfg is not None
    uri = build_uri(cfg, remark="имя")
    assert "path=%2Fvless%2F" in uri
    assert "path=%252F" not in uri
    assert "alpn=h2%2Chttp%2F1.1" in uri
    assert unquote(uri.split("#", 1)[1]) == "имя"
    again = parse_vless(uri)
    assert again is not None
    assert again.path == "/vless/"
    assert again.alpn == "h2,http/1.1"


def test_xhttp_and_new_encryption_stay_out_of_the_shared_list():
    xhttp = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=xhttp&security=tls&sni=cdn.example&mode=stream-up#x"
    )
    mlkem = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=tls&sni=cdn.example"
        "&encryption=mlkem768x25519plus.native.0rtt.demo#m"
    )
    bare = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=abc"
        "&sni=www.microsoft.com&fp=chrome#r"
    )
    vision = parse_vless(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=reality&pbk=abc&sid=aa"
        "&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#r"
    )
    assert xhttp is not None and not fits_popular_clients(xhttp)
    assert mlkem is not None and not fits_popular_clients(mlkem)
    assert bare is not None and not fits_popular_clients(bare)
    assert vision is not None and fits_popular_clients(vision)


def test_mihomo_batch_uses_the_clash_fields(tmp_path):
    cfg = parse_vless(
        f"vless://{UUID}@de.example:443?type=tcp&security=reality&pbk=abc&sid=aa"
        "&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#r"
    )
    assert cfg is not None
    document = build_mihomo_batch([(cfg, 18080)])
    proxy = document["proxies"][0]
    assert proxy["client-fingerprint"] == "chrome"
    assert proxy["reality-opts"]["public-key"] == "abc"
    assert proxy["flow"] == "xtls-rprx-vision"
    assert document["listeners"][0]["proxy"] == proxy["name"]
    assert document["listeners"][0]["port"] == 18080
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("shell", encoding="utf-8")
    cfg.country = "DE"
    cfg.core = "xray+sing-box+mihomo"
    cfg.verified = "proxy"
    cfg.latency_ms = 100
    extra = parse_vless(
        f"vless://22222222-2222-4222-8222-222222222222@x.example:443?type=xhttp&security=tls"
        "&sni=cdn.example&mode=auto#x"
    )
    assert extra is not None
    extra.country = "US"
    extra.verified = "proxy"
    extra.latency_ms = 200
    extra.core = "xray"
    out = tmp_path / "dist"
    publish(
        out_dir=out,
        site_dir=site,
        configs=[cfg],
        limited=[extra],
        reports=[],
        collected=2,
        tcp_tested=2,
        tcp_ok=2,
        proxy_tested=2,
        proxy_ok=1,
        generated_at="2026-10-06T00:00:00Z",
        settings=Settings(top_sizes=[20], clash_limit=0),
    )
    shared = (out / "sub" / "all.txt").read_text(encoding="utf-8")
    side = (out / "sub" / "xray.txt").read_text(encoding="utf-8")
    assert "de.example" in shared and "x.example" not in shared
    assert "x.example" in side and "type=xhttp" in side
    assert "\r" not in shared and "\r" not in side
    hub = json.loads((out / "data" / "configs.json").read_text(encoding="utf-8"))
    assert hub["configs"][0]["core"] == "xray+sing-box+mihomo"
    assert hub["limited"][0]["host"] == "x.example"
    from vlesshub.consistency import check_publish

    assert check_publish(out) == []


def test_client_buttons_use_subscription_schemes():
    node = subprocess.run(
        ["node", "--experimental-strip-types", "tests/client_links.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert node.returncode == 0, node.stdout + node.stderr
