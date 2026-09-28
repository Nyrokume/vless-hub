from vlesshub.parser import parse_vless
from vlesshub.probe import _CURL_WRITE, build_xray_batch, build_xray_config, parse_curl_write


def test_reality_tcp_outbound():
    cfg = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443"
        "?type=tcp&security=reality&pbk=abc+def&sid=aa&sni=www.microsoft.com"
        "&fp=chrome&flow=xtls-rprx-vision&encryption=none#r"
    )
    assert cfg is not None
    config = build_xray_config(cfg, 18080)
    outbound = config["outbounds"][0]
    user = outbound["settings"]["vnext"][0]["users"][0]
    assert user["flow"] == "xtls-rprx-vision"
    reality = outbound["streamSettings"]["realitySettings"]
    assert reality["publicKey"] == "abc+def"
    assert reality["shortId"] == "aa"
    assert reality["serverName"] == "www.microsoft.com"
    assert config["inbounds"][0]["port"] == 18080


def test_ws_grpc_xhttp_shapes():
    ws = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@h:443?type=ws&security=tls"
        "&path=%2Fsocket&host=cdn.example&sni=cdn.example&packetEncoding=xudp#w"
    )
    assert ws is not None
    stream = build_xray_config(ws, 1)["outbounds"][0]["streamSettings"]
    assert stream["network"] == "ws"
    assert stream["wsSettings"]["path"] == "/socket"
    assert stream["wsSettings"]["headers"]["Host"] == "cdn.example"
    assert stream["tlsSettings"]["serverName"] == "cdn.example"

    grpc = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@h:443?type=grpc&security=none"
        "&serviceName=demo&mode=multi#g"
    )
    assert grpc is not None
    grpc_settings = build_xray_config(grpc, 1)["outbounds"][0]["streamSettings"]["grpcSettings"]
    assert grpc_settings["serviceName"] == "demo"
    assert grpc_settings["multiMode"] is True

    xhttp = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@h:443?type=xhttp&security=reality"
        "&pbk=k&sid=ab&sni=s3.example.com&mode=stream-one&path=%2Fa"
        "&extra=%7B%22xmux%22%3A%7B%22maxConcurrency%22%3A%228%22%7D%7D#x"
    )
    assert xhttp is not None
    settings = build_xray_config(xhttp, 1)["outbounds"][0]["streamSettings"]["xhttpSettings"]
    assert settings["mode"] == "stream-one"
    assert settings["extra"]["xmux"]["maxConcurrency"] == "8"


def test_batch_routes_each_inbound_to_its_outbound():
    first = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@1.2.3.4:443"
        "?type=tcp&security=reality&pbk=abc+def&sid=aa&sni=www.microsoft.com#a"
    )
    second = parse_vless(
        "vless://22222222-2222-4222-8222-222222222222@5.6.7.8:8443?type=ws&security=none&path=%2Fw#b"
    )
    assert first is not None and second is not None
    config = build_xray_batch([(first, 18080), (second, 18081)])
    assert [item["port"] for item in config["inbounds"]] == [18080, 18081]
    assert [item["tag"] for item in config["inbounds"]] == ["in-0", "in-1"]
    assert config["outbounds"][0]["tag"] == "block"
    assert config["outbounds"][1]["settings"]["vnext"][0]["address"] == "1.2.3.4"
    assert config["outbounds"][1]["streamSettings"]["realitySettings"]["publicKey"] == "abc+def"
    assert config["outbounds"][2]["streamSettings"]["wsSettings"]["path"] == "/w"
    rules = {tuple(rule["inboundTag"]): rule["outboundTag"] for rule in config["routing"]["rules"]}
    assert rules == {("in-0",): "out-0", ("in-1",): "out-1"}


def test_latency_is_time_to_first_byte_not_process_startup():
    assert "time_starttransfer" in _CURL_WRITE
    code, start_ms, total_ms, size = parse_curl_write("204 0.412 0.640 0")
    assert code == 204
    assert start_ms == 412
    assert total_ms == 640
    assert size == 0
