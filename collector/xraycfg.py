"""Build an Xray config that gives each VLESS record its own SOCKS inbound."""

from __future__ import annotations


def _csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def stream_settings(config: dict) -> dict | None:
    network = config.get("transport") or "tcp"
    if network == "h2":
        network = "http"
    if network not in {"tcp", "ws", "grpc", "http", "httpupgrade", "xhttp", "kcp", "quic"}:
        return None
    extra = config.get("extra") or {}
    settings: dict = {"network": network, "security": config.get("security") or "none"}
    if network == "ws":
        ws: dict = {"path": config.get("path") or "/"}
        if config.get("host_header"):
            ws["headers"] = {"Host": config["host_header"]}
        settings["wsSettings"] = ws
    elif network == "grpc":
        settings["grpcSettings"] = {"serviceName": config.get("service_name") or ""}
    elif network == "httpupgrade":
        settings["httpupgradeSettings"] = {
            "path": config.get("path") or "/",
            "host": config.get("host_header") or "",
        }
    elif network == "xhttp":
        settings["xhttpSettings"] = {
            "path": config.get("path") or "/",
            "host": config.get("host_header") or "",
            "mode": extra.get("mode") or "auto",
        }
    elif network == "tcp":
        header = extra.get("headerType") or "none"
        if header and header != "none":
            settings["tcpSettings"] = {"header": {"type": header}}
    security = settings["security"]
    sni = config.get("sni") or config.get("host_header") or ""
    fingerprint = config.get("fingerprint") or "chrome"
    if security == "tls":
        tls: dict = {"serverName": sni, "fingerprint": fingerprint, "allowInsecure": True}
        alpn = extra.get("alpn")
        if alpn:
            tls["alpn"] = _csv(alpn)
        settings["tlsSettings"] = tls
    elif security == "reality":
        public_key = extra.get("pbk")
        if not public_key or not sni:
            return None
        settings["realitySettings"] = {
            "serverName": sni,
            "fingerprint": fingerprint,
            "publicKey": public_key,
            "shortId": extra.get("sid") or "",
            "spiderX": extra.get("spx") or "",
        }
    elif security not in {"none", ""}:
        return None
    return settings


def outbound(config: dict, tag: str) -> dict | None:
    stream = stream_settings(config)
    if stream is None:
        return None
    user: dict = {"id": config["uuid"], "encryption": "none"}
    flow = config.get("flow") or ""
    if flow and stream["network"] == "tcp" and stream["security"] in {"tls", "reality"}:
        user["flow"] = flow
    return {
        "tag": tag,
        "protocol": "vless",
        "settings": {
            "vnext": [
                {
                    "address": config["host"],
                    "port": int(config["port"]),
                    "users": [user],
                }
            ]
        },
        "streamSettings": stream,
    }


def batch_config(pairs: list[tuple[int, dict]]) -> dict | None:
    """pairs are (socks port, vless record). One Xray process, one inbound each."""
    inbounds = []
    outbounds = []
    rules = []
    for index, (port, config) in enumerate(pairs):
        tag = f"out-{index}"
        built = outbound(config, tag)
        if built is None:
            continue
        inbound_tag = f"in-{index}"
        inbounds.append(
            {
                "listen": "127.0.0.1",
                "port": port,
                "protocol": "socks",
                "settings": {"auth": "noauth", "udp": False},
                "tag": inbound_tag,
            }
        )
        outbounds.append(built)
        rules.append({"type": "field", "inboundTag": [inbound_tag], "outboundTag": tag})
    if not inbounds:
        return None
    outbounds.append({"protocol": "blackhole", "tag": "block"})
    return {
        "log": {"loglevel": "warning"},
        "inbounds": inbounds,
        "outbounds": outbounds,
        "routing": {"domainStrategy": "AsIs", "rules": rules},
    }
