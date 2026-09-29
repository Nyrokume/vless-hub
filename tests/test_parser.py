import base64
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from vlesshub.parser import (
    build_uri,
    dedup,
    extract_vless_uris,
    fingerprint,
    parse_any,
    parse_document,
    parse_many,
    parse_vless,
)

FIXTURES = json.loads((Path(__file__).parent / "fixtures.json").read_text(encoding="utf-8"))

REALITY = (
    "vless://11111111-1111-4111-8111-111111111111@Ex.COM:443"
    "?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome"
    "&pbk=abc+def/ghi=&sid=ab12&type=tcp&flow=xtls-rprx-vision&spx=%2F#Germany"
)


def test_fixtures_match_expected_fields():
    for item in FIXTURES:
        cfg = parse_vless(item["uri"])
        assert cfg is not None, item["name"]
        for key, value in item["expect"].items():
            assert getattr(cfg, key) == value, (item["name"], key, getattr(cfg, key))


def test_reality_plus_in_public_key_and_roundtrip():
    cfg = parse_vless(REALITY)
    assert cfg is not None
    assert cfg.pbk == "abc+def/ghi="
    assert cfg.spx == "/"
    assert cfg.host == "ex.com"
    assert cfg.uuid == "11111111-1111-4111-8111-111111111111"
    again = parse_vless(build_uri(cfg))
    assert again is not None
    assert again.fingerprint == cfg.fingerprint
    assert again.pbk == cfg.pbk
    assert again.flow == "xtls-rprx-vision"
    assert again.security == "reality"


def test_flag_in_remark_and_local_hosts():
    flagged = parse_vless(REALITY.replace("#Germany", "#🇳🇱 NL node"), source="alpha")
    assert flagged is not None
    assert flagged.remark_country == "NL"
    assert "🇳🇱" in flagged.remark
    plain = parse_vless(REALITY.replace("#Germany", "#plain"), source="beta")
    assert plain is not None
    preferred = dedup([plain, flagged])
    assert preferred[0].remark == "plain"
    assert preferred[0].remark_country == ""
    assert preferred[0].sources == ["beta", "alpha"]
    assert parse_vless(REALITY.replace("Ex.COM", "localhost")) is None
    assert parse_vless(REALITY.replace(":443", ":99999")) is None


def test_same_server_port_and_credentials_collapse_to_one():
    from vlesshub.parser import access_key

    user = "11111111-1111-4111-8111-111111111111"
    plain = parse_vless(
        f"vless://{user}@de.example:443?type=ws&security=none&path=/a#plain",
        source="alpha",
    )
    tls = parse_vless(
        f"vless://{user}@de.example:443?type=ws&security=tls&sni=de.example&path=/b#tls",
        source="beta",
    )
    other = parse_vless(
        "vless://22222222-2222-4222-8222-222222222222@de.example:443?type=tcp&security=none#other"
    )
    assert plain is not None and tls is not None and other is not None
    assert access_key(plain) == access_key(tls)
    assert plain.fingerprint != tls.fingerprint
    merged = dedup([plain, tls, other])
    assert len(merged) == 2
    kept = next(cfg for cfg in merged if cfg.host == "de.example" and cfg.uuid == user)
    assert kept.security == "tls"
    assert kept.sources == ["alpha", "beta"]


def test_remark_is_not_part_of_dedup_key():
    first = parse_vless(REALITY.replace("#Germany", "#one"), source="alpha")
    second = parse_vless(REALITY.replace("#Germany", "#two"), source="beta")
    assert first is not None and second is not None
    assert first.fingerprint == second.fingerprint
    merged = dedup([first, second])
    assert len(merged) == 1
    assert merged[0].sources == ["alpha", "beta"]
    assert merged[0].remark == "one"


def test_base64_subscription_and_html():
    plain = (
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=ws&security=tls&path=%2Fa#a\n"
        "vless://22222222-2222-4222-8222-222222222222@5.6.7.8:8443?type=grpc&security=none&serviceName=demo#b\n"
    )
    blob = base64.b64encode(plain.encode()).decode()
    parsed = parse_many(blob, source="blob")
    assert len(parsed) == 2
    assert {cfg.network for cfg in parsed} == {"ws", "grpc"}
    html = (
        "<div>hello <code>vless://11111111-1111-4111-8111-111111111111@9.9.9.9:443"
        "?security=tls&amp;type=ws&amp;path=/a#hi</code></div>"
    )
    found = extract_vless_uris(html)
    assert len(found) == 1
    cfg = parse_vless(found[0])
    assert cfg is not None
    assert cfg.path == "/a"
    assert cfg.security == "tls"


def test_ipv6_and_http_header_and_non_uuid():
    uri = (
        "vless://11111111-1111-4111-8111-111111111111@[2001:db8::1]:443"
        "?type=ws&security=tls&path=%2Fws&host=Example.com&sni=Example.com#v6"
    )
    cfg = parse_vless(uri)
    assert cfg is not None
    assert cfg.host == "2001:db8::1"
    assert cfg.port == 443
    assert cfg.host_header == "Example.com"
    rebuilt = build_uri(cfg)
    assert "[2001:db8::1]" in rebuilt

    header = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.1.1.1:80"
        "?security=none&encryption=none&host=amp.example&headerType=http&type=tcp#h"
    )
    assert header is not None
    assert header.network == "tcp"
    assert header.header_type == "http"

    odd = parse_vless("vless://%40Cooonfig%40@1.2.3.4:80?type=tcp&security=none#x")
    assert odd is not None
    assert odd.uuid == "@Cooonfig@"
    assert not odd.uuid.count("-") == 4 or "@" in odd.uuid


def test_raw_transport_is_tcp():
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=raw&security=reality&pbk=abc&sid=aa#r"
    )
    assert cfg is not None
    assert cfg.network == "tcp"


def test_false_security_means_none():
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:80?type=ws&security=false&path=%2F#x"
    )
    assert cfg is not None
    assert cfg.security == "none"


def test_fingerprint_stable_material():
    cfg = parse_vless(REALITY)
    assert cfg is not None
    assert fingerprint(cfg) == cfg.fingerprint
    assert len(cfg.fingerprint) == 16


def test_javascript_parser_matches_python():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    proc = subprocess.run(
        [node, "--experimental-strip-types", "tests/parser.test.mjs"],
        check=False,
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert proc.returncode == 0, proc.stderr
    rows = json.loads(proc.stdout)
    assert rows
    for row in rows:
        cfg = parse_vless(row["uri"])
        assert cfg is not None
        assert cfg.fingerprint == row["fingerprint"]
        assert cfg.network == row["network"]
        assert cfg.pbk == row["pbk"]
        assert cfg.host == row["host"]


def test_slash_before_query_and_plain_shadowsocks():
    vless = parse_any(
        "vless://11111111-1111-4111-8111-111111111111@104.16.72.70:443/"
        "?type=ws&security=tls&path=%2Fid#x"
    )
    assert vless is not None
    assert vless.port == 443 and vless.network == "ws" and vless.path == "/id"
    trojan = parse_any("trojan://!d8jYnLU)@172.66.46.215:8443/?type=tcp&security=tls&sni=anten.ir#t")
    assert trojan is not None and trojan.uuid == "!d8jYnLU)" and trojan.port == 8443
    hy2 = parse_any("hysteria2://secret@167.179.34.31:55443/?insecure=1&sni=example.com#h")
    assert hy2 is not None and hy2.port == 55443 and hy2.allow_insecure is True
    ss = parse_any(
        "ss://2022-blake3-aes-256-gcm:firstKey=:secondKey=@31.57.185.82:36969?type=tcp#s"
    )
    assert ss is not None
    assert ss.encryption == "2022-blake3-aes-256-gcm"
    assert ss.uuid == "firstKey=:secondKey="
    assert ss.port == 36969


def test_vmess_is_unsupported_and_broken_link_stays_parse_error():
    import base64

    blob = base64.b64encode(
        b'{"add":"1.2.3.4","id":"11111111-1111-4111-8111-111111111111","port":"443","net":"ws"}'
    ).decode()
    text = "\n".join(
        [
            f"ss://{blob}",
            "vmess://aabb",
            "ssr://aabb",
            "tuic://user:pass@1.2.3.4:443",
            "vless://not-closed",
            "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp#ok",
        ]
    )
    kept, reasons = parse_document(text, validate=True)
    assert len(kept) == 1
    assert reasons["unsupported_protocol"] == 3
    assert reasons["invalid_field"] >= 1
    assert reasons["parse_error"] == 1


def test_note_parameter_does_not_corrupt_the_fingerprint():
    from vlesshub.parser import extract_proxy_uris, fingerprint_material

    cfg = parse_any(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none&note=hello#x"
    )
    assert cfg is not None
    assert cfg.network == "tcp"
    assert "¬" not in fingerprint_material(cfg)
    htmlish = extract_proxy_uris(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:80?type=ws&amp;security=none#x"
    )
    assert htmlish and "security=none" in htmlish[0]


def test_extra_json_whitespace_is_one_fingerprint():
    from urllib.parse import quote

    left = parse_any(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none&extra="
        + quote('{"b":2,"a":1}')
        + "#x"
    )
    right = parse_any(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=tcp&security=none&extra="
        + quote('{\n  "a": 1,\n  "b": 2\n}')
        + "#y"
    )
    assert left is not None and right is not None
    assert left.fingerprint == right.fingerprint
    assert left.extra == '{"a":1,"b":2}'
