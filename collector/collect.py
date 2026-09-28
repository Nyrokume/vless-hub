#!/usr/bin/env python3
"""Collect public VLESS URIs, measure TCP connect latency, write data/ for the site.

Outputs (do not rename — the site and Pages workflow read these paths):
  data/configs.json
  data/subs/<id>.txt
  data/subs/<id>.b64.txt
"""

from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import socket
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from countries import country_name
from vlesslib import dedupe, extract_vless_uris, parse_vless

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR_VERSION = "1.0.0"
USER_AGENT = "vless-hub-collector/1.0"
FAST_MS = 300
MAX_PUBLISH = 140
PER_NETWORK = 3

SUBSCRIPTION_SPECS = (
    ("all", "Все рабочие", "Все конфиги, ответившие на TCP-проверку"),
    ("fast", "Быстрые", f"Задержка TCP не выше {FAST_MS} мс"),
    ("reality", "Reality", "security=reality"),
    ("tls", "TLS", "security=tls"),
    ("tcp", "VLESS / TCP", "Транспорт TCP"),
    ("ws", "VLESS / WS", "Транспорт WebSocket"),
    ("grpc", "VLESS / gRPC", "Транспорт gRPC"),
    ("xhttp", "VLESS / XHTTP", "Транспорт XHTTP"),
    ("httpupgrade", "VLESS / HTTPUpgrade", "Транспорт HTTPUpgrade"),
)


def fetch(url: str, timeout: float) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def load_sources(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise SystemExit(f"No sources in {path}")
    return data


def is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def tcp_latency(host: str, port: int, timeout: float) -> int | None:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return max(1, int((time.perf_counter() - started) * 1000))
    except Exception:
        return None


def select_for_test(configs: list[dict], limit: int) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    order: list[str] = []
    for config in configs:
        host = config["host"].lower()
        if host not in buckets:
            buckets[host] = []
            order.append(host)
        buckets[host].append(config)
    for bucket in buckets.values():
        bucket.sort(key=lambda item: (0 if item.get("country_code") else 1, item["transport"]))
    selected: list[dict] = []
    while len(selected) < limit:
        progressed = False
        for host in order:
            bucket = buckets[host]
            if not bucket:
                continue
            selected.append(bucket.pop(0))
            progressed = True
            if len(selected) >= limit:
                break
        if not progressed:
            break
    return selected


def lookup_countries(hosts: list[str]) -> dict[str, tuple[str, str]]:
    """Map host/IP → (code, english name) via ip-api. Failures return nothing."""
    queries = []
    for host in dict.fromkeys(hosts):
        if is_ip(host):
            queries.append(host)
            continue
        try:
            infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except Exception:
            continue
        for info in infos:
            address = info[4][0]
            if address and is_ip(address) and not address.startswith("127."):
                queries.append(address)
                break
    if not queries:
        return {}
    found: dict[str, tuple[str, str]] = {}
    # ip-api batch accepts up to 100 addresses per call.
    unique_queries = list(dict.fromkeys(queries))
    for offset in range(0, len(unique_queries), 100):
        chunk = unique_queries[offset : offset + 100]
        body = json.dumps([{"query": item} for item in chunk]).encode()
        request = urllib.request.Request(
            "http://ip-api.com/batch?fields=status,country,countryCode,query",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.loads(response.read().decode())
        except Exception as error:
            print(f"geo lookup failed: {error}", file=sys.stderr)
            continue
        for row in payload:
            if not isinstance(row, dict) or row.get("status") != "success":
                continue
            code = (row.get("countryCode") or "").upper()
            if code == "UK":
                code = "GB"
            if len(code) == 2 and code.isalpha():
                found[row.get("query")] = (code, row.get("country") or code)
    # Re-associate original hosts. IPs map directly; names use the resolved address
    # we queried, which is also stored under that address.
    resolved: dict[str, tuple[str, str]] = {}
    for host in hosts:
        if host in found:
            resolved[host] = found[host]
            continue
        if is_ip(host):
            continue
        try:
            infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        except Exception:
            continue
        for info in infos:
            address = info[4][0]
            if address in found:
                resolved[host] = found[address]
                break
    return resolved


def subscription_members(configs: list[dict], sub_id: str) -> list[dict]:
    if sub_id == "all":
        return configs
    if sub_id == "fast":
        return [item for item in configs if item["latency_ms"] <= FAST_MS]
    if sub_id in {"reality", "tls"}:
        return [item for item in configs if item["security"] == sub_id]
    return [item for item in configs if item["transport"] == sub_id]


def write_subscription(directory: Path, sub_id: str, title: str, configs: list[dict], generated_at: str) -> None:
    header = "\n".join(
        (
            f"#profile-title: vless-hub — {title}",
            "#profile-update-interval: 1",
            "#support-url: https://github.com/Nyrokume/vless-hub",
            "#profile-web-page-url: https://nyrokume.github.io/vless-hub/",
            f"#generated-at: {generated_at}",
            "",
        )
    )
    body = header + "\n".join(item["uri"] for item in configs) + "\n"
    plain = directory / f"{sub_id}.txt"
    encoded = directory / f"{sub_id}.b64.txt"
    plain.write_text(body, encoding="utf-8")
    encoded.write_text(base64.b64encode(body.encode()).decode() + "\n", encoding="utf-8")


def network_key(host: str) -> str:
    """Bucket IPv4 by /24 so one CDN prefix cannot fill the published list."""
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return host.lower()
    if isinstance(ip, ipaddress.IPv4Address):
        parts = host.split(".")
        return ".".join(parts[:3])
    network = ipaddress.ip_network(f"{ip}/48", strict=False)
    return str(network.network_address)


def diversify(configs: list[dict], limit: int) -> list[dict]:
    counts: Counter[str] = Counter()
    chosen: list[dict] = []
    for item in configs:
        key = network_key(item["host"])
        if counts[key] >= PER_NETWORK:
            continue
        counts[key] += 1
        chosen.append(item)
        if len(chosen) >= limit:
            break
    return chosen


def median(values: list[int]) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) // 2


def build(args: argparse.Namespace) -> int:
    started = time.perf_counter()
    sources = load_sources(args.sources)
    parsed: list[dict] = []
    source_reports = []
    for source in sources:
        report = {
            "id": source["id"],
            "name": source["name"],
            "url": source["url"],
            "ok": False,
            "fetched": 0,
            "error": None,
        }
        try:
            payload = fetch(source["url"], args.fetch_timeout)
            uris = extract_vless_uris(payload)
            report["fetched"] = len(uris)
            report["ok"] = True
            for uri in uris:
                config = parse_vless(uri, source["id"])
                if config:
                    parsed.append(config)
            print(f"fetched {report['fetched']} from {source['name']}")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            report["error"] = str(error)
            print(f"source failed {source['name']}: {error}", file=sys.stderr)
        source_reports.append(report)

    if not any(item["ok"] for item in source_reports):
        print("every source failed; leaving existing data in place", file=sys.stderr)
        return 1

    unique = dedupe(parsed)
    candidates = select_for_test(unique, args.max_test)
    print(f"unique {len(unique)}; testing {len(candidates)}")

    alive: list[dict] = []
    tested_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    socket.setdefaulttimeout(args.timeout)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(tcp_latency, item["host"], item["port"], args.timeout): item
            for item in candidates
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            item = futures[future]
            latency = future.result()
            if latency is not None:
                record = dict(item)
                record["latency_ms"] = latency
                record["tested_at"] = tested_at
                alive.append(record)
            if done % 40 == 0 or done == len(futures):
                print(f"tested {done}/{len(futures)}; alive {len(alive)}")

    if not alive:
        print("no configs accepted a TCP connection; leaving existing data in place", file=sys.stderr)
        return 1

    alive.sort(key=lambda item: (item["latency_ms"], item["id"]))
    published = diversify(alive, MAX_PUBLISH)

    # One lookup covers both the IP-country column and filling a missing label.
    ip_geo = lookup_countries([item["host"] for item in published])
    for item in published:
        hit = ip_geo.get(item["host"])
        if hit:
            item["ip_country_code"] = hit[0]
            item["ip_country"] = country_name(hit[0], hit[1])
        if item.get("country_code"):
            continue
        if not hit:
            item["country"] = None
            item["country_source"] = None
            continue
        item["country_code"] = hit[0]
        item["country"] = country_name(hit[0], hit[1])
        item["country_source"] = "geoip"

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    out = args.out
    subs_dir = out / "subs"
    subs_dir.mkdir(parents=True, exist_ok=True)
    # Drop subscription files from a previous run so removed groups do not linger.
    for stale in subs_dir.glob("*"):
        if stale.is_file():
            stale.unlink()

    subscriptions = []
    for sub_id, title, description in SUBSCRIPTION_SPECS:
        members = subscription_members(published, sub_id)
        if not members:
            continue
        write_subscription(subs_dir, sub_id, title, members, generated_at)
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

    transports = Counter(item["transport"] for item in published)
    countries = {item["country_code"] for item in published if item.get("country_code")}
    document = {
        "version": 1,
        "collector_version": COLLECTOR_VERSION,
        "generated_at": generated_at,
        "duration_sec": round(time.perf_counter() - started, 1),
        "probe": "tcp-connect",
        "fast_threshold_ms": FAST_MS,
        "sources": source_reports,
        "stats": {
            "fetched": sum(item["fetched"] for item in source_reports),
            "unique": len(unique),
            "tested": len(candidates),
            "alive": len(alive),
            "published": len(published),
            "countries": len(countries),
            "median_latency_ms": median([item["latency_ms"] for item in published]),
            "transports": dict(sorted(transports.items())),
        },
        "subscriptions": subscriptions,
        "configs": published,
    }
    target = out / "configs.json"
    temporary = out / "configs.json.tmp"
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(
        f"wrote {target} ({len(published)} configs, median {document['stats']['median_latency_ms']} ms)"
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect and probe public VLESS configs")
    parser.add_argument("--sources", type=Path, default=ROOT / "collector" / "sources.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data")
    parser.add_argument("--max-test", type=int, default=240)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--fetch-timeout", type=float, default=45.0)
    parser.add_argument("--workers", type=int, default=80)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(build(parse_args()))
