import base64

from vlesshub.consistency import check_publish
from vlesshub.export import publish
from vlesshub.models import Settings
from vlesshub.parser import parse_vless
from vlesshub.tgparse import TgProxy


def _publish(tmp_path):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("shell", encoding="utf-8")
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@de.example:443"
        "?type=tcp&security=reality&pbk=abcdefghijklmnopqrstuvwxyz&sid=aa"
        "&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#orig"
    )
    assert cfg is not None
    cfg.country = "DE"
    cfg.country_name = "Germany"
    cfg.latency_ms = 420
    cfg.verified = "proxy"
    proxy = TgProxy(kind="mtproto", host="149.154.167.51", port=443, secret="ab" * 16, status="working")
    proxy.latency_ms = 80
    out = tmp_path / "dist"
    publish(
        out_dir=out,
        site_dir=site,
        configs=[cfg],
        reports=[],
        collected=1,
        tcp_tested=1,
        tcp_ok=1,
        proxy_tested=1,
        proxy_ok=1,
        generated_at="2026-09-29T00:00:00Z",
        settings=Settings(top_sizes=[20], clash_limit=0),
        proxies=[proxy],
    )
    return out


def test_every_export_matches_the_verified_list(tmp_path):
    out = _publish(tmp_path)
    assert check_publish(out) == []
    plain = (out / "sub" / "all.txt").read_text(encoding="utf-8")
    assert "://" not in "\n".join(line for line in plain.splitlines() if line.startswith("#"))
    decoded = base64.b64decode((out / "data" / "subs" / "all.b64.txt").read_text()).decode()
    body = [line.split("#", 1)[0] for line in decoded.splitlines() if line and not line.startswith("#")]
    listed = [line.split("#", 1)[0] for line in plain.splitlines() if line and not line.startswith("#")]
    assert body == listed


def test_an_extra_link_fails_the_export_check(tmp_path):
    out = _publish(tmp_path)
    path = out / "sub" / "all.txt"
    path.write_text(
        path.read_text(encoding="utf-8") + "vless://22222222-2222-4222-8222-222222222222@extra.example:443\n",
        encoding="utf-8",
    )
    errors = check_publish(out)
    assert errors
    assert any("all.txt" in item for item in errors)


def test_a_link_inside_a_comment_fails_the_export_check(tmp_path):
    out = _publish(tmp_path)
    path = out / "data" / "subs" / "all.txt"
    path.write_text("#support-url: https://nyrokume.github.io/vless-hub/\n" + path.read_text(encoding="utf-8"), encoding="utf-8")
    errors = check_publish(out)
    assert any("comment contains a link" in item for item in errors)
