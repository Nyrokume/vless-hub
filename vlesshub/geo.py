from __future__ import annotations

import ipaddress
import json
import socket
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from vlesshub.models import VlessConfig
from vlesshub.util import log

_TTL_SEC = 7 * 24 * 3600


class GeoCache:
    def __init__(self, hosts: dict[str, dict] | None = None) -> None:
        self.hosts: dict[str, dict] = hosts or {}

    @classmethod
    def load(cls, path: Path) -> GeoCache:
        if not path.is_file():
            return cls()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls()
        hosts = payload.get("hosts") if isinstance(payload, dict) else None
        if not isinstance(hosts, dict):
            return cls()
        return cls(hosts=hosts)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if len(self.hosts) > 25000:
            ranked = sorted(self.hosts.items(), key=lambda item: int(item[1].get("ts") or 0))
            self.hosts = dict(ranked[-25000:])
        payload = {"version": 1, "hosts": {key: self.hosts[key] for key in sorted(self.hosts)}}
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def fresh(self, host: str) -> dict | None:
        entry = self.hosts.get(host.lower())
        if not entry:
            return None
        if time.time() - float(entry.get("ts") or 0) > _TTL_SEC:
            return None
        return entry


def enrich(configs: list[VlessConfig], cache: GeoCache, mmdb_path: Path | None, user_agent: str) -> None:
    reader = _open_mmdb(mmdb_path)
    pending_ips: list[str] = []
    now = int(time.time())
    misses: list[VlessConfig] = []
    for cfg in configs:
        host = cfg.host.lower()
        cached = cache.fresh(host)
        if cached:
            cfg.ip = str(cached.get("ip") or "")
            cfg.country = str(cached.get("cc") or "")
            cfg.country_name = str(cached.get("name") or "")
            continue
        misses.append(cfg)
    resolved = _resolve_many([cfg.host.lower() for cfg in misses])
    for cfg in misses:
        host = cfg.host.lower()
        ip = resolved.get(host)
        cc, name = "", ""
        if ip and _is_public(ip) and reader is not None:
            cc, name = _lookup_mmdb(reader, ip)
        cfg.ip = ip or ""
        cfg.country = cc
        cfg.country_name = name
        cache.hosts[host] = {"ip": cfg.ip, "cc": cc, "name": name, "ts": now}
        if ip and _is_public(ip) and not cc:
            pending_ips.append(ip)
    if reader is not None:
        reader.close()
    if not pending_ips:
        return
    looked = _ip_api_batch(sorted(set(pending_ips)), user_agent)
    if not looked:
        return
    for cfg in configs:
        if cfg.country or not cfg.ip:
            continue
        found = looked.get(cfg.ip)
        if not found:
            continue
        cfg.country, cfg.country_name = found
        entry = cache.hosts.get(cfg.host.lower())
        if entry is not None:
            entry["cc"] = cfg.country
            entry["name"] = cfg.country_name


def _open_mmdb(path: Path | None):
    if path is None or not path.is_file():
        return None
    try:
        import maxminddb
    except ImportError:
        log("maxminddb is not installed; country lookup will fall back")
        return None
    try:
        return maxminddb.open_database(str(path))
    except Exception as exc:  # noqa: BLE001
        log(f"geoip database unreadable: {exc}")
        return None


def _lookup_mmdb(reader: object, ip: str) -> tuple[str, str]:
    try:
        record = reader.get(ip)  # type: ignore[attr-defined]
    except Exception:
        return "", ""
    if not isinstance(record, dict):
        return "", ""
    country = record.get("country") or record.get("registered_country") or {}
    if not isinstance(country, dict):
        return "", ""
    code = normalize_country_code(str(country.get("iso_code") or ""))
    names = country.get("names") if isinstance(country.get("names"), dict) else {}
    name = str(names.get("en") or "")
    return code, name


def normalize_country_code(code: str) -> str:
    """Keep ISO alpha-2 codes. Routing DBs sometimes store CLOUDFLARE/FASTLY here."""
    cleaned = (code or "").strip().upper()
    if len(cleaned) == 2 and cleaned.isalpha():
        return cleaned
    return ""


def _resolve_many(hosts: list[str]) -> dict[str, str | None]:
    unique = list(dict.fromkeys(hosts))
    if not unique:
        return {}
    resolved: dict[str, str | None] = {}
    workers = min(64, len(unique))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_resolve, host): host for host in unique}
        for future in as_completed(futures):
            host = futures[future]
            try:
                resolved[host] = future.result()
            except Exception:  # noqa: BLE001
                resolved[host] = None
    return resolved


def _resolve(host: str) -> str | None:
    if _is_ip(host):
        return host
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except OSError:
        return None
    ips = [item[4][0] for item in infos if item[4]]
    v4 = [ip for ip in ips if ":" not in ip]
    if v4:
        return v4[0]
    return ips[0] if ips else None


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _is_public(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return ip.is_global


def _ip_api_batch(ips: list[str], user_agent: str) -> dict[str, tuple[str, str]]:
    found: dict[str, tuple[str, str]] = {}
    for offset in range(0, len(ips), 100):
        chunk = ips[offset : offset + 100]
        body = json.dumps([{"query": ip} for ip in chunk]).encode("utf-8")
        request = urllib.request.Request(
            "http://ip-api.com/batch?fields=status,country,countryCode,query",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": user_agent},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
        except Exception as exc:  # noqa: BLE001
            log(f"ip-api fallback failed: {exc}")
            break
        if isinstance(payload, list):
            for item in payload:
                if not isinstance(item, dict) or item.get("status") != "success":
                    continue
                query = str(item.get("query") or "")
                code = str(item.get("countryCode") or "").upper()
                name = str(item.get("country") or "")
                if query and code:
                    found[query] = (code, name)
        if offset + 100 < len(ips):
            time.sleep(1.5)
    return found
