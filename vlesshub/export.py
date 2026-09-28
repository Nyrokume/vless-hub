from __future__ import annotations

import base64
import json
import re
import shutil
import statistics
from pathlib import Path

import yaml

from vlesshub.countries import country_name
from vlesshub.models import Settings, SourceReport, VlessConfig
from vlesshub.parser import build_uri
from vlesshub.tgparse import TgProxy, https_link, tg_link

_FAST_MS = 300
_COLLECTOR_VERSION = "2.0.0"
_LEGACY_SUBS = (
    ("all", "Все рабочие", "Прокси проверены запросом через Xray"),
    ("fast", "Быстрые", f"Задержка HTTP не выше {_FAST_MS} мс"),
    ("reality", "Reality", "security=reality"),
    ("tls", "TLS", "security=tls"),
    ("tcp", "VLESS / TCP", "Транспорт TCP"),
    ("ws", "VLESS / WS", "Транспорт WebSocket"),
    ("grpc", "VLESS / gRPC", "Транспорт gRPC"),
    ("xhttp", "VLESS / XHTTP", "Транспорт XHTTP"),
)

_PAGE = "https://nyrokume.github.io/vless-hub/"
_HEADER = (
    "#profile-title: V2Hub\n"
    "#profile-update-interval: 6\n"
    f"#support-url: {_PAGE}\n"
    f"#profile-web-page-url: {_PAGE}\n"
)
_UNVERIFIED_HEADER = (
    "#profile-title: V2Hub — непроверенные (только открытый порт)\n"
    "#profile-update-interval: 6\n"
    f"#support-url: {_PAGE}\n"
    f"#profile-web-page-url: {_PAGE}\n"
)


def publish(
    *,
    out_dir: Path,
    site_dir: Path,
    configs: list[VlessConfig],
    reports: list[SourceReport],
    collected: int,
    tcp_tested: int,
    tcp_ok: int,
    proxy_tested: int,
    proxy_ok: int,
    generated_at: str,
    settings: Settings,
    duration_sec: float = 0,
    unverified: list[VlessConfig] | None = None,
    proxies: list[TgProxy] | None = None,
    tg_reports: list[SourceReport] | None = None,
    tg_collected: int = 0,
    tg_tested: int = 0,
) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    _prepare_output(out_dir, site_dir)

    unverified = list(unverified or [])
    for cfg in unverified:
        cfg.latency_ms = None
        cfg.speed_kbps = None
        cfg.verified = "tcp"

    catalog: list[dict] = []
    _write_pair(out_dir, "sub/all.txt", configs, catalog, kind="all")
    # Same proxy-verified set, kept so older subscription URLs still resolve.
    _write_pair(out_dir, "sub/verified.txt", configs, catalog, kind="verified")
    _write_pair(
        out_dir,
        "sub/unverified.txt",
        unverified,
        catalog,
        kind="unverified",
        header=_UNVERIFIED_HEADER,
    )

    for size in settings.top_sizes:
        _write_pair(
            out_dir,
            f"sub/top-{size}.txt",
            configs[:size],
            catalog,
            kind="top",
            top=size,
        )
    top_default = 50 if 50 in settings.top_sizes else (settings.top_sizes[0] if settings.top_sizes else 20)
    _write_pair(out_dir, "sub/top.txt", configs[:top_default], catalog, kind="top", top=top_default)

    for country in _grouped(configs, lambda cfg: _country(cfg)):
        code = country
        _write_pair(
            out_dir,
            f"sub/country/{code}.txt",
            _grouped(configs, lambda cfg: _country(cfg))[code],
            catalog,
            kind="country",
            country=code,
        )
    for security, group in _grouped(configs, lambda cfg: cfg.security or "none").items():
        _write_pair(
            out_dir,
            f"sub/security/{security}.txt",
            group,
            catalog,
            kind="security",
            security=security,
        )
    for network, group in _grouped(configs, lambda cfg: cfg.network or "tcp").items():
        _write_pair(
            out_dir,
            f"sub/transport/{network}.txt",
            group,
            catalog,
            kind="transport",
            network=network,
        )
    combos = _grouped(configs, lambda cfg: f"{_country(cfg)}-{cfg.security or 'none'}")
    for key, group in combos.items():
        _write_pair(
            out_dir,
            f"sub/combo/{key}.txt",
            group,
            catalog,
            kind="combo",
            country=key.split("-", 1)[0],
            security=key.split("-", 1)[1],
        )

    clash_configs = configs[: settings.clash_limit]
    _write_clash(out_dir / "sub/clash.yaml", clash_configs)
    _write_singbox(out_dir / "sub/singbox.json", clash_configs)
    catalog.append({"path": "sub/clash.yaml", "kind": "clash", "format": "clash", "count": len(clash_configs)})
    catalog.append({"path": "sub/singbox.json", "kind": "singbox", "format": "singbox", "count": len(clash_configs)})

    proxies = list(proxies or [])
    tg_reports = list(tg_reports or [])
    _write_telegram(out_dir, proxies, settings, generated_at)
    public = [_public_config(cfg) for cfg in configs]
    public_unverified = [_public_config(cfg) for cfg in unverified]
    (out_dir / "api").mkdir(parents=True, exist_ok=True)
    (out_dir / "api/configs.json").write_text(
        json.dumps(
            {"generated_at": generated_at, "configs": public, "unverified": public_unverified},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    stats = _stats(
        configs=configs,
        unverified_count=len(unverified),
        reports=reports,
        collected=collected,
        tcp_tested=tcp_tested,
        tcp_ok=tcp_ok,
        proxy_tested=proxy_tested,
        proxy_ok=proxy_ok,
        generated_at=generated_at,
        catalog=catalog,
        proxies=proxies,
        tg_reports=tg_reports,
        tg_collected=tg_collected,
        tg_tested=tg_tested,
    )
    (out_dir / "api/stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _write_site_payload(
        out_dir,
        configs=configs,
        unverified=unverified,
        proxies=proxies,
        reports=reports,
        tg_reports=tg_reports,
        stats=stats,
        catalog=catalog,
        generated_at=generated_at,
        duration_sec=duration_sec,
        clash_count=len(clash_configs),
    )


def _prepare_output(out_dir: Path, site_dir: Path) -> None:
    """Static shells are copied into the artifact. The Vite app is built separately."""
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")
    if not site_dir.is_dir() or (site_dir / "package.json").is_file():
        return
    for item in site_dir.iterdir():
        dest = out_dir / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)


def _legacy_members(configs: list[VlessConfig], sub_id: str) -> list[VlessConfig]:
    if sub_id == "all":
        return configs
    if sub_id == "fast":
        return [cfg for cfg in configs if cfg.latency_ms is not None and cfg.latency_ms <= _FAST_MS]
    if sub_id in {"reality", "tls"}:
        return [cfg for cfg in configs if cfg.security == sub_id]
    return [cfg for cfg in configs if (cfg.network or "tcp") == sub_id]


def _write_legacy_sub(directory: Path, sub_id: str, title: str, configs: list[VlessConfig]) -> None:
    body = _plain_body(configs, header=False)
    header = (
        f"#profile-title: V2Hub — {title}\n"
        "#profile-update-interval: 6\n"
        f"#support-url: {_PAGE}\n"
        f"#profile-web-page-url: {_PAGE}\n"
    )
    plain = header + body
    (directory / f"{sub_id}.txt").write_text(plain, encoding="utf-8")
    encoded = base64.b64encode(plain.encode("utf-8")).decode("ascii")
    (directory / f"{sub_id}.b64.txt").write_text(encoded + "\n", encoding="utf-8")


def _hub_config(cfg: VlessConfig, generated_at: str) -> dict:
    code, name, source = _place(cfg)
    ip_code = _country(cfg)
    ip_code_out = None if ip_code == "ZZ" else ip_code
    return {
        "id": cfg.fingerprint,
        "uri": build_uri(cfg, remark=display_name(cfg)),
        "remark": cfg.remark,
        "uuid": cfg.uuid,
        "host": cfg.host,
        "port": cfg.port,
        "transport": cfg.network or "tcp",
        "security": cfg.security or "none",
        "sni": cfg.sni,
        "flow": cfg.flow,
        "path": cfg.path,
        "host_header": cfg.host_header,
        "service_name": cfg.service_name,
        "fingerprint": cfg.fp,
        "country_code": code,
        "country": name,
        "country_source": source,
        "ip_country_code": ip_code_out,
        "ip_country": (country_name(ip_code_out) if ip_code_out else None) or cfg.country_name or None,
        "extra": dict(cfg.extras),
        "source": cfg.sources[0] if cfg.sources else "",
        "latency_ms": None if cfg.latency_ms is None else round(float(cfg.latency_ms), 1),
        "tested_at": generated_at,
        "uptime": round(cfg.uptime, 4),
        "checks_ok": cfg.checks_ok,
        "checks_fail": cfg.checks_fail,
        "bits": cfg.bits,
        "verified": cfg.verified,
        "speed_kbps": None if cfg.speed_kbps is None else round(float(cfg.speed_kbps), 1),
    }


def _place(cfg: VlessConfig) -> tuple[str | None, str | None, str | None]:
    flag = (cfg.remark_country or "").upper()
    if len(flag) == 2 and flag.isalpha():
        return flag, country_name(flag) or flag, "remark"
    code = (cfg.country or "").upper()
    if len(code) == 2 and code.isalpha():
        return code, country_name(code) or cfg.country_name or code, "geoip"
    return None, None, None


def _hub_source(report: SourceReport) -> dict:
    return {
        "id": report.name,
        "name": report.name,
        "url": report.url,
        "ok": report.ok,
        "fetched": report.links,
        "error": report.error or None,
    }


def _write_site_payload(
    out_dir: Path,
    *,
    configs: list[VlessConfig],
    unverified: list[VlessConfig],
    proxies: list[TgProxy],
    reports: list[SourceReport],
    tg_reports: list[SourceReport],
    stats: dict,
    catalog: list[dict],
    generated_at: str,
    duration_sec: float,
    clash_count: int,
) -> None:
    subs_dir = out_dir / "data" / "subs"
    subs_dir.mkdir(parents=True, exist_ok=True)
    subscriptions = []
    for sub_id, title, description in _LEGACY_SUBS:
        members = _legacy_members(configs, sub_id)
        _write_legacy_sub(subs_dir, sub_id, title, members)
        subscriptions.append(
            {
                "id": sub_id,
                "name": title,
                "description": description,
                "file": f"subs/{sub_id}.txt",
                "b64": f"subs/{sub_id}.b64.txt",
                "count": len(members),
            }
        )
    clash_src = out_dir / "sub" / "clash.yaml"
    sing_src = out_dir / "sub" / "singbox.json"
    if clash_src.is_file():
        shutil.copyfile(clash_src, subs_dir / "clash.yaml")
    if sing_src.is_file():
        shutil.copyfile(sing_src, subs_dir / "singbox.json")
    subscriptions.append(
        {
            "id": "clash",
            "name": "Clash",
            "description": "Clash Meta и Mihomo",
            "file": "subs/clash.yaml",
            "b64": "",
            "count": clash_count,
        }
    )
    subscriptions.append(
        {
            "id": "singbox",
            "name": "sing-box",
            "description": "Профиль sing-box",
            "file": "subs/singbox.json",
            "b64": "",
            "count": clash_count,
        }
    )
    counts = stats["counts"]
    telegram = stats["telegram"]
    hub = {
        "version": 2,
        "collector_version": _COLLECTOR_VERSION,
        "generated_at": generated_at,
        "duration_sec": duration_sec,
        "probe": "xray-http",
        "fast_threshold_ms": _FAST_MS,
        "sources": [_hub_source(report) for report in reports + tg_reports],
        "stats": {
            "fetched": counts["collected"],
            "unique": counts["collected"],
            "tested": counts["tested_tcp"],
            "alive": counts["tcp_ok"],
            "published": counts["published"],
            "countries": counts["countries"],
            "median_latency_ms": stats["median_latency_ms"],
            "transports": stats["by_network"],
            "unverified": counts["unverified"],
            "proxy_tested": counts["tested_proxy"],
            "proxy_ok": counts["proxy_ok"],
            "telegram": {
                "collected": telegram["collected"],
                "tested": telegram["tested"],
                "published": telegram["published"],
                "mtproto": telegram["mtproto"],
                "socks": telegram["socks"],
                "median_latency_ms": telegram["median_latency_ms"],
            },
        },
        "subscriptions": subscriptions,
        "catalog": [item for item in catalog if item.get("format") != "base64"],
        "configs": [_hub_config(cfg, generated_at) for cfg in configs],
        "unverified": [_hub_config(cfg, generated_at) for cfg in unverified],
        "proxies": [_public_proxy(proxy) for proxy in proxies],
    }
    (out_dir / "data" / "configs.json").write_text(
        json.dumps(hub, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_pair(
    out_dir: Path,
    relative: str,
    configs: list[VlessConfig],
    catalog: list[dict],
    *,
    kind: str,
    country: str = "",
    security: str = "",
    network: str = "",
    top: int | None = None,
    header: str | None = None,
) -> None:
    plain_path = out_dir / relative
    plain_path.parent.mkdir(parents=True, exist_ok=True)
    body = _plain_body(configs, header=False)
    plain_path.write_text((header or _HEADER) + body, encoding="utf-8")
    encoded = base64.b64encode(body.encode("utf-8")).decode("ascii")
    b64_relative = "sub/base64/" + relative[len("sub/") :]
    b64_path = out_dir / b64_relative
    b64_path.parent.mkdir(parents=True, exist_ok=True)
    b64_path.write_text(encoded + "\n", encoding="utf-8")
    base = {
        "kind": kind,
        "country": country,
        "security": security,
        "network": network,
        "top": top,
        "count": len(configs),
    }
    catalog.append({**base, "path": relative, "format": "plain"})
    catalog.append({**base, "path": b64_relative, "format": "base64"})


def _plain_body(configs: list[VlessConfig], header: bool) -> str:
    lines = [build_uri(cfg, remark=display_name(cfg)) for cfg in configs]
    body = "\n".join(lines)
    if body:
        body += "\n"
    if header:
        return _HEADER + body
    return body


_GARBAGE = re.compile(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F\u200D\u200B\u200C\u2060]+")


def _clean_label(value: str, limit: int = 40) -> str:
    text = _GARBAGE.sub(" ", value or "")
    text = "".join(ch for ch in text if ch.isprintable())
    return " ".join(text.split())[:limit]


def _latency_label(value: float) -> str:
    if value < 10:
        return f"{value:.1f}ms"
    return f"{int(round(value))}ms"


def display_name(cfg: VlessConfig) -> str:
    parts: list[str] = []
    if cfg.country:
        parts.append(cfg.country)
    if cfg.latency_ms is not None:
        parts.append(_latency_label(cfg.latency_ms))
    parts.append(cfg.security or "none")
    parts.append(cfg.network or "tcp")
    if cfg.remark:
        short = _clean_label(cfg.remark)
        if short:
            parts.append(short)
    return " · ".join(parts)


def _public_config(cfg: VlessConfig) -> dict:
    return {
        "id": cfg.fingerprint,
        "uri": build_uri(cfg, remark=display_name(cfg)),
        "name": display_name(cfg),
        "remark": cfg.remark,
        "uuid": cfg.uuid,
        "host": cfg.host,
        "port": cfg.port,
        "ip": cfg.ip,
        "country": cfg.country,
        "country_name": cfg.country_name,
        "encryption": cfg.encryption,
        "flow": cfg.flow,
        "network": cfg.network,
        "security": cfg.security,
        "sni": cfg.sni,
        "fp": cfg.fp,
        "pbk": cfg.pbk,
        "sid": cfg.sid,
        "spx": cfg.spx,
        "path": cfg.path,
        "host_header": cfg.host_header,
        "service_name": cfg.service_name,
        "mode": cfg.mode,
        "alpn": cfg.alpn,
        "header_type": cfg.header_type,
        "packet_encoding": cfg.packet_encoding,
        "allow_insecure": cfg.allow_insecure,
        "latency_ms": cfg.latency_ms,
        "speed_kbps": cfg.speed_kbps,
        "uptime": round(cfg.uptime, 4),
        "checks_ok": cfg.checks_ok,
        "checks_fail": cfg.checks_fail,
        "bits": cfg.bits,
        "verified": cfg.verified,
        "sources": cfg.sources,
    }


def _stats(
    *,
    configs: list[VlessConfig],
    unverified_count: int,
    reports: list[SourceReport],
    collected: int,
    tcp_tested: int,
    tcp_ok: int,
    proxy_tested: int,
    proxy_ok: int,
    generated_at: str,
    catalog: list[dict],
    proxies: list[TgProxy] | None = None,
    tg_reports: list[SourceReport] | None = None,
    tg_collected: int = 0,
    tg_tested: int = 0,
) -> dict:
    latencies = [cfg.latency_ms for cfg in configs if cfg.latency_ms is not None]
    proxies = list(proxies or [])
    tg_reports = list(tg_reports or [])
    tg_latency = [proxy.latency_ms for proxy in proxies if proxy.latency_ms is not None]
    mtproto = [proxy for proxy in proxies if proxy.kind == "mtproto"]
    socks = [proxy for proxy in proxies if proxy.kind == "socks"]
    telegram = {
        "collected": tg_collected,
        "tested": tg_tested,
        "published": len(proxies),
        "mtproto": len(mtproto),
        "socks": len(socks),
        "countries": len({proxy.country for proxy in proxies if proxy.country}),
        "median_latency_ms": round(statistics.median(tg_latency), 1) if tg_latency else None,
        "by_country": _count(proxies, lambda proxy: proxy.country or "ZZ"),
        "by_kind": _count(proxies, lambda proxy: proxy.kind),
        "sources": [_source_row(report) for report in tg_reports],
    }
    return {
        "generated_at": generated_at,
        "counts": {
            "collected": collected,
            "tested_tcp": tcp_tested,
            "tcp_ok": tcp_ok,
            "tested_proxy": proxy_tested,
            "proxy_ok": proxy_ok,
            "published": len(configs),
            "unverified": unverified_count,
            "countries": len({cfg.country for cfg in configs if cfg.country}),
            "sources_ok": sum(1 for report in reports if report.ok),
            "sources_total": len(reports),
            "tg_published": len(proxies),
            "tg_mtproto": len(mtproto),
            "tg_socks": len(socks),
            "tg_tested": tg_tested,
        },
        "median_latency_ms": round(statistics.median(latencies), 1) if latencies else None,
        "by_country": _count(configs, lambda cfg: cfg.country or "ZZ"),
        "by_security": _count(configs, lambda cfg: cfg.security or "none"),
        "by_network": _count(configs, lambda cfg: cfg.network or "tcp"),
        "by_verified": _count(configs, lambda cfg: cfg.verified or "unknown"),
        "sources": [_source_row(report) for report in reports],
        "subscriptions": catalog,
        "telegram": telegram,
    }


def _write_clash(path: Path, configs: list[VlessConfig]) -> None:
    proxies = [_clash_proxy(cfg, index) for index, cfg in enumerate(configs, start=1)]
    names = [item["name"] for item in proxies]
    document = {
        "mixed-port": 7890,
        "allow-lan": False,
        "mode": "rule",
        "log-level": "warning",
        "proxies": proxies,
        "proxy-groups": [
            {"name": "V2Hub", "type": "select", "proxies": names + ["DIRECT"]},
        ],
        "rules": ["MATCH,V2Hub"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(document, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _clash_proxy(cfg: VlessConfig, index: int) -> dict:
    name = f"{_country(cfg)}-{cfg.network}-{cfg.port}-{index}"
    item: dict = {
        "name": name,
        "type": "vless",
        "server": cfg.host,
        "port": cfg.port,
        "uuid": cfg.uuid,
        "udp": True,
        "network": {"h2": "h2"}.get(cfg.network, cfg.network or "tcp"),
    }
    if cfg.flow and cfg.network == "tcp":
        item["flow"] = cfg.flow
    if cfg.packet_encoding:
        item["packet-encoding"] = cfg.packet_encoding
    if cfg.security in {"tls", "reality"}:
        item["tls"] = True
        item["servername"] = cfg.sni or cfg.host_header or cfg.host
        if cfg.fp or cfg.security == "reality":
            item["client-fingerprint"] = cfg.fp or "chrome"
        if cfg.alpn:
            item["alpn"] = [part.strip() for part in cfg.alpn.split(",") if part.strip()]
        if cfg.allow_insecure:
            item["skip-cert-verify"] = True
    if cfg.security == "reality":
        item["reality-opts"] = {"public-key": cfg.pbk, "short-id": cfg.sid}
    if cfg.network == "ws":
        ws: dict = {"path": cfg.path or "/"}
        if cfg.host_header:
            ws["headers"] = {"Host": cfg.host_header}
        item["ws-opts"] = ws
    elif cfg.network == "grpc":
        item["grpc-opts"] = {"grpc-service-name": cfg.service_name}
    elif cfg.network == "h2":
        item["h2-opts"] = {
            "path": cfg.path or "/",
            "host": [cfg.host_header] if cfg.host_header else [],
        }
    elif cfg.network == "xhttp":
        opts: dict = {"path": cfg.path or "/", "mode": cfg.mode or "auto"}
        if cfg.host_header:
            opts["host"] = cfg.host_header
        item["xhttp-opts"] = opts
    elif cfg.network == "httpupgrade":
        opts = {"path": cfg.path or "/"}
        if cfg.host_header:
            opts["host"] = cfg.host_header
        item["httpupgrade-opts"] = opts
    return item


def _write_singbox(path: Path, configs: list[VlessConfig]) -> None:
    outbounds = [_singbox_outbound(cfg, index) for index, cfg in enumerate(configs, start=1)]
    tags = [item["tag"] for item in outbounds]
    outbounds.append({"type": "direct", "tag": "direct"})
    outbounds.append({"type": "selector", "tag": "select", "outbounds": tags + ["direct"], "default": tags[0] if tags else "direct"})
    document = {
        "log": {"level": "warn"},
        "inbounds": [
            {"type": "mixed", "tag": "mixed-in", "listen": "127.0.0.1", "listen_port": 2080}
        ],
        "outbounds": outbounds,
        "route": {"final": "select"},
    }
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _singbox_outbound(cfg: VlessConfig, index: int) -> dict:
    item: dict = {
        "type": "vless",
        "tag": f"{_country(cfg)}-{cfg.network}-{index}",
        "server": cfg.host,
        "server_port": cfg.port,
        "uuid": cfg.uuid,
    }
    if cfg.flow and cfg.network == "tcp":
        item["flow"] = cfg.flow
    if cfg.packet_encoding:
        item["packet_encoding"] = cfg.packet_encoding
    if cfg.security in {"tls", "reality"}:
        tls: dict = {
            "enabled": True,
            "server_name": cfg.sni or cfg.host_header or cfg.host,
            "insecure": bool(cfg.allow_insecure),
        }
        if cfg.fp or cfg.security == "reality":
            tls["utls"] = {"enabled": True, "fingerprint": cfg.fp or "chrome"}
        if cfg.alpn:
            tls["alpn"] = [part.strip() for part in cfg.alpn.split(",") if part.strip()]
        if cfg.security == "reality":
            tls["reality"] = {"enabled": True, "public_key": cfg.pbk, "short_id": cfg.sid}
        item["tls"] = tls
    transport = _singbox_transport(cfg)
    if transport:
        item["transport"] = transport
    return item


def _singbox_transport(cfg: VlessConfig) -> dict | None:
    if cfg.network == "ws":
        transport: dict = {"type": "ws", "path": cfg.path or "/"}
        if cfg.host_header:
            transport["headers"] = {"Host": cfg.host_header}
        return transport
    if cfg.network == "grpc":
        return {"type": "grpc", "service_name": cfg.service_name}
    if cfg.network == "h2":
        transport = {"type": "http", "path": cfg.path or "/"}
        if cfg.host_header:
            transport["host"] = [part.strip() for part in cfg.host_header.split(",") if part.strip()]
        return transport
    if cfg.network == "xhttp":
        transport = {"type": "xhttp", "path": cfg.path or "/", "mode": cfg.mode or "auto"}
        if cfg.host_header:
            transport["host"] = cfg.host_header
        return transport
    if cfg.network == "httpupgrade":
        transport = {"type": "httpupgrade", "path": cfg.path or "/"}
        if cfg.host_header:
            transport["host"] = cfg.host_header
        return transport
    return None


def _write_telegram(out_dir: Path, proxies: list[TgProxy], settings: Settings, generated_at: str) -> None:
    mtproto = [proxy for proxy in proxies if proxy.kind == "mtproto"]
    socks = [proxy for proxy in proxies if proxy.kind == "socks"]
    _tg_lines(out_dir / "tg/mtproto.txt", [tg_link(proxy) for proxy in mtproto])
    _tg_lines(out_dir / "tg/mtproto-https.txt", [https_link(proxy) for proxy in mtproto])
    _tg_lines(out_dir / "tg/socks.txt", [tg_link(proxy) for proxy in socks])
    _tg_lines(out_dir / "tg/socks-https.txt", [https_link(proxy) for proxy in socks])
    _tg_lines(out_dir / "tg/all.txt", [tg_link(proxy) for proxy in proxies])
    _tg_lines(out_dir / "tg/https.txt", [https_link(proxy) for proxy in proxies])
    for size in settings.tg_top_sizes:
        _tg_lines(out_dir / f"tg/top-{size}.txt", [tg_link(proxy) for proxy in proxies[:size]])
        _tg_lines(out_dir / f"tg/mtproto-top-{size}.txt", [tg_link(proxy) for proxy in mtproto[:size]])
        _tg_lines(out_dir / f"tg/socks-top-{size}.txt", [tg_link(proxy) for proxy in socks[:size]])
    (out_dir / "api").mkdir(parents=True, exist_ok=True)
    (out_dir / "api/proxies.json").write_text(
        json.dumps(
            {"generated_at": generated_at, "proxies": [_public_proxy(proxy) for proxy in proxies]},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _tg_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(lines)
    if body:
        body += "\n"
    path.write_text(body, encoding="utf-8")


def _public_proxy(proxy: TgProxy) -> dict:
    return {
        "id": proxy.fingerprint,
        "kind": proxy.kind,
        "host": proxy.host,
        "port": proxy.port,
        "secret": proxy.secret,
        "mode": proxy.mode,
        "domain": proxy.domain,
        "user": proxy.user,
        "country": proxy.country,
        "country_name": country_name(proxy.country) or proxy.country_name,
        "ip": proxy.ip,
        "latency_ms": proxy.latency_ms,
        "uptime": round(proxy.uptime, 4),
        "checks_ok": proxy.checks_ok,
        "checks_fail": proxy.checks_fail,
        "bits": proxy.bits,
        "tg": tg_link(proxy),
        "https": https_link(proxy),
        "sources": proxy.sources,
    }


def _source_row(report: SourceReport) -> dict:
    return {
        "name": report.name,
        "url": report.url,
        "ok": report.ok,
        "status": report.status,
        "links": report.links,
        "kept": report.kept,
        "elapsed_ms": report.elapsed_ms,
        "error": report.error,
    }


def _grouped(configs: list[VlessConfig], key) -> dict[str, list[VlessConfig]]:
    groups: dict[str, list[VlessConfig]] = {}
    for cfg in configs:
        groups.setdefault(str(key(cfg)), []).append(cfg)
    return dict(sorted(groups.items()))


def _count(configs: list[VlessConfig], key) -> dict[str, int]:
    counts: dict[str, int] = {}
    for cfg in configs:
        name = str(key(cfg))
        counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _country(cfg: VlessConfig) -> str:
    code = (cfg.country or "").upper()
    if len(code) == 2 and code.isalpha():
        return code
    return "ZZ"
