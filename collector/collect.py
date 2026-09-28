#!/usr/bin/env python3
"""Collect public VLESS configs and proxies, measure real delay, write data/ for the site.

Outputs (do not rename — the site and Pages workflow read these paths):
  data/configs.json
  data/best.txt
  data/subs/<id>.txt
  data/subs/<id>.b64.txt
  data/subs/mtproto.txt
  data/subs/socks5.txt
"""

from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import os
import shutil
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
from proxylib import check_proxy, parse_proxy_payload
from realdelay import probe_vless, tcp_open
from vlesslib import dedupe, extract_vless_uris, parse_vless

ROOT = Path(__file__).resolve().parents[1]
COLLECTOR_VERSION = "1.1.0"
USER_AGENT = "vless-hub-collector/1.1"
FAST_MS = 800
MAX_PUBLISH = 140
MAX_PROXIES = 80
PER_NETWORK = 3

SUBSCRIPTION_SPECS = (
    ("all", "Все рабочие", "Конфиги с real-delay: HTTP 204 через Xray"),
    ("fast", "Быстрые", f"Real-delay не выше {FAST_MS} мс"),
    ("reality", "Reality", "security=reality"),
    ("tls", "TLS", "security=tls"),
    ("tcp", "VLESS / TCP", "Транспорт TCP"),
    ("ws", "VLESS / WS", "Транспорт WebSocket"),
    ("grpc", "VLESS / gRPC", "Транспорт gRPC"),
    ("xhttp", "VLESS / XHTTP", "Транспорт XHTTP"),
    ("httpupgrade", "VLESS / HTTPUpgrade", "Транспорт HTTPUpgrade"),
)

PROXY_SUBS = (
    ("mtproto", "Telegram MTProto", "Прокси Telegram. check=real — рукопожатие, check=tcp — только TCP"),
    ("socks5", "SOCKS5", "SOCKS5, ответившие HTTP 204"),
    ("http", "HTTP", "HTTP-прокси, ответившие HTTP 204"),
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


def find_xray(explicit: str | None) -> str | None:
    if explicit:
        return explicit if Path(explicit).is_file() else None
    env = os.environ.get("XRAY_BIN")
    if env and Path(env).is_file():
        return env
    bundled = ROOT / "collector" / "bin" / "xray"
    if bundled.is_file():
        return str(bundled)
    return shutil.which("xray")


def choose_best(configs: list[dict]) -> dict | None:
    """Lowest real delay. Ties prefer more successful attempts, then a stable id."""
    real = [item for item in configs if item.get("check") == "real" and isinstance(item.get("delay_ms"), int)]
    if not real:
        return None
    return min(real, key=lambda item: (item["delay_ms"], -int(item.get("successes") or 0), item["id"]))


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
        bucket.sort(key=lambda item: (0 if item.get("country_code") else 1, item.get("transport") or item.get("kind") or ""))
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
        return [item for item in configs if item.get("delay_ms", item.get("latency_ms", 10**9)) <= FAST_MS]
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


def load_previous(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def apply_geo(records: list[dict]) -> None:
    ip_geo = lookup_countries([item["host"] for item in records])
    for item in records:
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


def build(args: argparse.Namespace) -> int:
    started = time.perf_counter()
    sources = load_sources(args.sources)
    parsed: list[dict] = []
    proxy_candidates: list[dict] = []
    source_reports = []
    vless_ok = False
    proxy_ok = False
    for source in sources:
        kind = source.get("kind") or "vless"
        report = {
            "id": source["id"],
            "name": source["name"],
            "url": source["url"],
            "kind": kind,
            "ok": False,
            "fetched": 0,
            "error": None,
        }
        try:
            payload = fetch(source["url"], args.fetch_timeout)
            if kind == "vless":
                uris = extract_vless_uris(payload)
                report["fetched"] = len(uris)
                for uri in uris:
                    config = parse_vless(uri, source["id"])
                    if config:
                        parsed.append(config)
            else:
                proxies = parse_proxy_payload(kind, payload, source["id"])
                report["fetched"] = len(proxies)
                proxy_candidates.extend(proxies)
            report["ok"] = True
            if kind == "vless":
                vless_ok = True
            else:
                proxy_ok = True
            print(f"fetched {report['fetched']} from {source['name']}")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            report["error"] = str(error)
            print(f"source failed {source['name']}: {error}", file=sys.stderr)
        source_reports.append(report)

    if not vless_ok and not proxy_ok:
        print("every source failed; leaving existing data in place", file=sys.stderr)
        return 1

    out = args.out
    previous = load_previous(out / "configs.json")
    tested_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    published: list[dict] = []
    proxies_published: list[dict] = []
    tested_count = 0
    tcp_alive = 0

    if vless_ok:
        binary = find_xray(args.xray)
        if not binary:
            print("xray binary not found; leaving existing data in place", file=sys.stderr)
            return 1
        unique = dedupe(parsed)
        candidates = select_for_test(unique, args.max_test)
        print(f"unique {len(unique)}; tcp pre-filter {len(candidates)}")
        reachable: list[dict] = []
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(tcp_open, item["host"], int(item["port"]), args.tcp_timeout): item
                for item in candidates
            }
            for future in as_completed(futures):
                if future.result():
                    reachable.append(futures[future])
        tcp_alive = len(reachable)
        tested_count = len(candidates)
        print(f"tcp open {tcp_alive}; real-delay via {binary}")
        passed = probe_vless(
            reachable,
            binary,
            batch_size=args.batch,
            attempts=args.attempts,
            timeout=args.real_timeout,
        )
        for item in passed:
            item["tested_at"] = tested_at
        passed.sort(key=lambda item: (item["delay_ms"], -int(item.get("successes") or 0), item["id"]))
        published = diversify(passed, MAX_PUBLISH)
        best = choose_best(passed)
        if best and all(item["id"] != best["id"] for item in published):
            published.insert(0, best)
            published = published[:MAX_PUBLISH]
    else:
        print("vless sources failed; keeping previously published configs")
        published = list(previous.get("configs") or [])
        unique = published
        best = previous.get("best") if isinstance(previous.get("best"), dict) else None

    if proxy_ok:
        # One record per endpoint, spread across sources, then cap the expensive checks.
        deduped: dict[str, dict] = {}
        for item in proxy_candidates:
            deduped.setdefault(item["id"], item)
        by_kind: dict[str, list[dict]] = {}
        for item in deduped.values():
            by_kind.setdefault(item["kind"], []).append(item)
        # Spread the budget across kinds, and TCP-filter a wider pool first.
        prefilter: list[dict] = []
        per_kind = max(12, args.max_proxy)
        for bucket in by_kind.values():
            prefilter.extend(bucket[: per_kind * 3])
        print(f"proxies fetched {len(deduped)}; tcp pre-filter {len(prefilter)}")
        reachable: list[dict] = []
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(tcp_open, item["host"], int(item["port"]), args.tcp_timeout): item
                for item in prefilter
            }
            for future in as_completed(futures):
                if future.result():
                    reachable.append(futures[future])
        limited = []
        buckets = {}
        for item in reachable:
            buckets.setdefault(item["kind"], []).append(item)
        while len(limited) < args.max_proxy and any(buckets.values()):
            for kind in list(buckets):
                bucket = buckets[kind]
                if not bucket or len(limited) >= args.max_proxy:
                    continue
                limited.append(bucket.pop(0))
        print(f"proxies tcp-open {len(reachable)}; checking {len(limited)}")
        checked: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(args.workers, 40)) as pool:
            futures = [pool.submit(check_proxy, item, args.real_timeout, 2) for item in limited]
            for future in as_completed(futures):
                result = future.result()
                if result:
                    result["tested_at"] = tested_at
                    checked.append(result)
        checked.sort(
            key=lambda item: (
                0 if item["check"] == "real" else 1,
                item["delay_ms"],
                item["id"],
            )
        )
        proxies_published = diversify(checked, MAX_PROXIES)
        print(
            f"proxies kept {len(proxies_published)} "
            f"(real {sum(1 for item in proxies_published if item['check'] == 'real')})"
        )
    else:
        print("proxy sources failed; keeping previously published proxies")
        proxies_published = list(previous.get("proxies") or [])

    apply_geo([*published, *proxies_published])
    if vless_ok:
        best = choose_best(published) or choose_best(
            [item for item in published if item.get("check") == "real"]
        )
        # choose_best(published) is correct because published is a subset of passed,
        # except when we prepended best. Re-pick from published so the link is in the list.
        best = choose_best(published)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    subs_dir = out / "subs"
    subs_dir.mkdir(parents=True, exist_ok=True)
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
                "kind": "vless",
            }
        )
    for sub_id, title, description in PROXY_SUBS:
        members = [item for item in proxies_published if item.get("kind") == sub_id]
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
                "kind": sub_id,
            }
        )

    if best and best.get("uri"):
        (out / "best.txt").write_text(best["uri"].strip() + "\n", encoding="utf-8")
    elif (out / "best.txt").is_file() and not vless_ok:
        pass
    else:
        (out / "best.txt").write_text("", encoding="utf-8")

    real_configs = [item for item in published if item.get("check") == "real"]
    real_proxies = [item for item in proxies_published if item.get("check") == "real"]
    countries = {
        item.get("country_code")
        for item in [*published, *proxies_published]
        if item.get("country_code")
    }
    config_median = median([item["delay_ms"] for item in real_configs if isinstance(item.get("delay_ms"), int)])
    proxy_median = median([item["delay_ms"] for item in real_proxies if isinstance(item.get("delay_ms"), int)])
    transports = Counter(item["transport"] for item in published if item.get("transport"))
    document = {
        "version": 2,
        "collector_version": COLLECTOR_VERSION,
        "generated_at": generated_at,
        "duration_sec": round(time.perf_counter() - started, 1),
        "probe": "real-delay",
        "fast_threshold_ms": FAST_MS,
        "sources": source_reports,
        "best": best,
        "stats": {
            "fetched": sum(item["fetched"] for item in source_reports),
            "unique": len(unique) if vless_ok else len(published),
            "tested": tested_count,
            "alive": tcp_alive,
            "published": len(published),
            "proxies": len(proxies_published),
            "proxies_real": len(real_proxies),
            "proxies_tcp": sum(1 for item in proxies_published if item.get("check") == "tcp"),
            "countries": len(countries),
            "median_delay_ms": config_median,
            "median_proxy_delay_ms": proxy_median,
            "median_latency_ms": config_median,
            "transports": dict(sorted(transports.items())),
        },
        "subscriptions": subscriptions,
        "configs": published,
        "proxies": proxies_published,
    }
    target = out / "configs.json"
    temporary = out / "configs.json.tmp"
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(
        f"wrote {target} ({len(published)} configs, median {config_median} ms, "
        f"{len(proxies_published)} proxies, proxy median {proxy_median} ms)"
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect VLESS configs and proxies, then measure real delay")
    parser.add_argument("--sources", type=Path, default=ROOT / "collector" / "sources.json")
    parser.add_argument("--out", type=Path, default=ROOT / "data")
    parser.add_argument("--xray", default=None, help="Path to the xray binary")
    parser.add_argument("--max-test", type=int, default=120)
    parser.add_argument("--max-proxy", type=int, default=40)
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--tcp-timeout", type=float, default=2.0)
    parser.add_argument("--real-timeout", type=float, default=5.0)
    parser.add_argument("--fetch-timeout", type=float, default=45.0)
    parser.add_argument("--workers", type=int, default=80)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(build(parse_args()))
