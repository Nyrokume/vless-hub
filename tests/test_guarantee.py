from vlesshub.health import DISABLE_AFTER, PAUSE_RUNS, begin_run, note_fetch, note_yield
from vlesshub.history import History
from vlesshub.models import SourceReport
from vlesshub.parser import exported_config, fingerprint_material, invalid_reason, parse_any
from vlesshub.rank import mix_proxy_targets, reserve_diverse
from vlesshub.vantage import interpret

UUID = "11111111-1111-4111-8111-111111111111"
PBK = "abcdefghijklmnopqrstuvwx"


def _round_trip(uri: str):
    cfg = parse_any(uri)
    assert cfg is not None
    assert invalid_reason(cfg) is None
    again = exported_config(cfg)
    assert again is not None
    assert fingerprint_material(again) == fingerprint_material(cfg)
    assert again.fp.lower() == cfg.fp.lower()
    assert again.protocol == cfg.protocol
    return again


def test_share_link_round_trip_matches_the_parsed_config():
    _round_trip(
        f"vless://{UUID}@de.example:443?encryption=none&flow=xtls-rprx-vision"
        f"&type=tcp&security=reality&sni=www.microsoft.com&fp=chrome&pbk={PBK}&sid=abcd#r"
    )
    _round_trip(
        f"vless://{UUID}@cdn.example:443?encryption=none&type=ws&security=tls"
        "&sni=cdn.example&path=%2Fws&host=cdn.example&fp=chrome#w"
    )
    _round_trip("ss://YWVzLTI1Ni1nY206c2VjcmV0@10.1.2.3:8388#s")
    _round_trip("trojan://secret@nl.example:443?security=tls&sni=nl.example&type=ws&path=%2Ft#t")
    _round_trip("hysteria2://secret@hy2.example:443?sni=hy2.example&insecure=1#h")
    tuic = _round_trip(f"tuic://{UUID}:secret@tuic.example:443?sni=tuic.example#u")
    assert tuic.protocol == "tuic"
    assert tuic.extras["password"] == "secret"


def test_incomplete_tls_and_reality_fields_are_rejected():
    flow = parse_any(
        f"vless://{UUID}@1.2.3.4:443?type=ws&security=none&flow=xtls-rprx-vision#x"
    )
    assert flow is not None and invalid_reason(flow) == "invalid_field"
    sid = parse_any(
        f"vless://{UUID}@1.2.3.4:443?type=tcp&security=reality&pbk={PBK}"
        "&sid=zz&sni=www.microsoft.com&fp=chrome#x"
    )
    assert sid is not None and invalid_reason(sid) == "invalid_field"
    bare = parse_any(f"vless://{UUID}@1.2.3.4:443?type=tcp&security=tls#x")
    assert bare is not None and invalid_reason(bare) == "invalid_field"
    broken = parse_any("tuic://user:pass@1.2.3.4:443")
    assert broken is not None and invalid_reason(broken) == "invalid_field"


def test_diverse_slice_keeps_websocket_when_tcp_fills_the_budget():
    history = History()
    tcp = []
    for index in range(20):
        cfg = parse_any(f"vless://{UUID}@tcp{index}.example:443?type=tcp&security=none#x")
        assert cfg is not None
        tcp.append(cfg)
    ws = parse_any(
        f"vless://{UUID}@ws.example:443?type=ws&security=tls&sni=ws.example&path=/a#w"
    )
    assert ws is not None
    chosen = reserve_diverse(tcp + [ws], history, limit=10, drop_after=4)
    assert any(cfg.network == "ws" for cfg in chosen)
    mixed = mix_proxy_targets(tcp + [ws], [], history, limit=10, drop_after=4)
    assert any(cfg.network == "ws" for cfg in mixed)


def test_dead_source_pauses_and_returns_after_the_skip():
    health = {"sources": {}}
    for _ in range(DISABLE_AFTER):
        note_yield(health, "dead-feed", tested=10, verified=0)
    assert health["sources"]["dead-feed"]["disabled"] is True
    assert health["sources"]["dead-feed"]["skip_left"] == PAUSE_RUNS
    assert "dead-feed" in begin_run(health)
    assert health["sources"]["dead-feed"]["skip_left"] == PAUSE_RUNS - 1
    health["sources"]["dead-feed"]["skip_left"] = 1
    assert "dead-feed" not in begin_run(health)
    assert health["sources"]["dead-feed"]["disabled"] is False

    health = {"sources": {}}
    report = SourceReport(name="gone", url="https://example.invalid", ok=False, error="timeout")
    for _ in range(DISABLE_AFTER):
        note_fetch(health, report)
    assert report.disabled is True
    streak = health["sources"]["gone"]["fetch_streak"]
    paused = SourceReport(name="gone", url="https://example.invalid", ok=False, error="auto-disabled")
    note_fetch(health, paused)
    assert paused.disabled is True
    assert health["sources"]["gone"]["fetch_streak"] == streak


def test_vantage_marks_russia_as_a_plus():
    from vlesshub.vantage import russia_verdict

    both = {
        "ru1.node.check-host.net": [{"address": "1.1.1.1", "time": 0.03}],
        "de1.node.check-host.net": [{"address": "1.1.1.1", "time": 0.01}],
    }
    assert interpret(both) == "multi"
    assert interpret({"ru1.node.check-host.net": [{"time": 0.03}]}) == "ru"
    assert interpret({"de1.node.check-host.net": [{"time": 0.01}]}) == "other"
    assert interpret({"ru1.node.check-host.net": [None]}) == ""
    assert russia_verdict(both) == "open"
    assert russia_verdict({"ru1.node.check-host.net": [{"error": "Connection timed out"}]}) == "closed"
    assert russia_verdict({"ru1.node.check-host.net": None}) == "unknown"
    assert russia_verdict({"de1.node.check-host.net": [{"time": 0.01}]}) == "unknown"
