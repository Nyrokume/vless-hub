import base64
from pathlib import Path

from vlesshub.export import display_name
from vlesshub.parser import dedup, invalid_reason, parse_any, parse_document, parse_vless
from vlesshub.probe import build_hy2_outbound, build_outbound

SAMPLE = (Path(__file__).parent / "wild-sample.txt").read_text(encoding="utf-8")
LINES = SAMPLE.splitlines()


def _line(number: int) -> str:
    return LINES[number - 1]


def test_sip002_padding_variants_and_legacy_form():
    padded = parse_any(_line(1))
    unpadded = parse_any(_line(2))
    encoded = parse_any(_line(27))
    bare = parse_any(_line(28))
    assert padded is not None and padded.protocol == "shadowsocks"
    assert padded.encryption == "chacha20-ietf-poly1305"
    assert padded.host == "45.9.75.37" and padded.port == 8000
    assert padded.remark_country == ""
    assert unpadded is not None
    assert unpadded.encryption == "aes-256-gcm"
    assert unpadded.uuid == "895b4b796a357570"
    assert encoded is not None and bare is not None
    assert encoded.fingerprint == bare.fingerprint == parse_any(_line(26)).fingerprint
    legacy_raw = base64.b64encode(b"aes-256-gcm:secret@10.1.2.3:8388").decode()
    legacy = parse_any(f"ss://{legacy_raw}#legacy")
    assert legacy is not None
    assert legacy.encryption == "aes-256-gcm"
    assert legacy.uuid == "secret"
    assert legacy.host == "10.1.2.3" and legacy.port == 8388


def test_xhttp_modes_extra_and_raw_tcp():
    packet = parse_any(_line(3))
    auto = parse_any(_line(8))
    stream_one = parse_any(_line(16))
    stream_up = parse_any(_line(22))
    raw = parse_any(_line(20))
    assert packet is not None and packet.network == "xhttp" and packet.mode == "packet-up"
    assert auto is not None and auto.network == "xhttp"
    assert '"xPaddingBytes"' in auto.extra
    assert stream_one is not None and stream_one.network == "xhttp" and stream_one.security == "none"
    assert stream_up is not None and stream_up.network == "xhttp"
    assert stream_up.alpn == "h3,h2"
    assert raw is not None and raw.network == "tcp" and raw.header_type == ""
    plain_http = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?type=http&security=tls&path=%2Fh2#h"
    )
    assert plain_http is not None and plain_http.network == "h2"


def test_http_obfuscation_empty_fields_case_and_spam():
    http = parse_any(_line(5))
    assert http is not None
    assert http.header_type == "http"
    assert http.host_header == "dl.google.com,speedtest.net,play.google.com"
    empty_fp = parse_any(_line(21))
    assert empty_fp is not None and empty_fp.fp == ""
    empty_header = parse_any(_line(4))
    assert empty_header is not None and empty_header.header_type == ""
    leading = parse_any(_line(6))
    assert leading is not None and leading.security == "reality" and leading.pbk
    spam = parse_any(_line(9))
    assert spam is not None
    assert "telegram" not in spam.extras
    assert spam.fp == "edge"
    junk_alpn = parse_any(_line(23))
    assert junk_alpn is not None and junk_alpn.alpn == ""
    junk_host = parse_any(_line(29))
    assert junk_host is not None and junk_host.host_header == ""
    outbound = build_outbound(http)
    hosts = outbound["streamSettings"]["tcpSettings"]["header"]["request"]["headers"]["Host"]
    assert hosts == ["dl.google.com", "speedtest.net", "play.google.com"]


def test_other_protocols_and_dedup_prefers_chrome():
    trojan = parse_any(_line(12))
    hy2 = parse_any(_line(17))
    assert trojan is not None and trojan.protocol == "trojan" and trojan.security == "tls"
    assert trojan.uuid == "sg-trojan-2026"
    assert hy2 is not None and hy2.protocol == "hysteria2"
    assert hy2.extras["obfs"] == "salamander"
    assert hy2.allow_insecure is True
    sing = build_hy2_outbound(hy2)
    assert sing["obfs"]["type"] == "salamander"
    ss_outbound = build_outbound(parse_any(_line(1)))
    assert ss_outbound["protocol"] == "shadowsocks"
    trojan_outbound = build_outbound(trojan)
    assert trojan_outbound["protocol"] == "trojan"

    configs, reasons = parse_document(SAMPLE, source="wild", validate=True)
    assert reasons["invalid_field"] >= 1
    merged = dedup(configs)
    fingerprints = {cfg.fingerprint: cfg for cfg in merged}
    chrome = next(cfg for cfg in merged if cfg.uuid.startswith("692e3be7"))
    assert chrome.fp == "chrome"
    assert chrome.network == "xhttp"
    same_host = [cfg for cfg in merged if cfg.host == "15.204.97.216" and cfg.port == 23576]
    assert len(same_host) == 1
    assert same_host[0].fp == "chrome"
    other_ip = [cfg for cfg in merged if cfg.host == "15.204.97.195"]
    assert len(other_ip) == 1
    assert other_ip[0].fingerprint not in {same_host[0].fingerprint}
    ss_group = [cfg for cfg in merged if cfg.host == "84.247.155.196"]
    assert len(ss_group) == 1
    assert len(merged) < len(configs)
    assert fingerprints


def test_truncated_uuid_pbk_and_port_are_rejected():
    truncated = parse_any(_line(34))
    assert truncated is not None
    assert invalid_reason(truncated) == "invalid_field"
    kept, reasons = parse_document(_line(34), validate=True)
    assert kept == []
    assert reasons["invalid_field"] == 1
    odd = parse_vless("vless://not-a-uuid@1.2.3.4:443?type=tcp&security=none#x")
    assert odd is not None and invalid_reason(odd) == "invalid_field"
    missing_pbk = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443?security=reality&sni=www.example.com#x"
    )
    assert missing_pbk is not None and invalid_reason(missing_pbk) == "invalid_field"
    short_sni = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443"
        "?security=reality&sni=www&pbk=JAG5rl6KEt7KAV0y8Z2x6orWHymCXRSX49SkEnEftWU#x"
    )
    assert short_sni is not None and invalid_reason(short_sni) == "invalid_field"
    assert parse_any("vless://11111111-1111-4111-8111-111111111111@1.2.3.4:70000?type=tcp#x") is None
    broken, broken_reasons = parse_document(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:70000?type=tcp#x\nnot a link",
        validate=True,
    )
    assert broken == []
    assert broken_reasons["parse_error"] == 1


def test_display_name_ignores_remark_latency_and_country():
    cfg = parse_any(_line(1))
    assert cfg is not None
    cfg.country = "DE"
    cfg.latency_ms = 412
    name = display_name(cfg)
    assert "136" not in name
    assert "@vlesstrojan" not in name
    assert "SS" in name
    assert "412ms" in name
    assert "Германия" in name
