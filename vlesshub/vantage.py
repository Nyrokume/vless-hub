"""Optional TCP checks from check-host.net. A plus, never a reason to drop a config."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from vlesshub.models import VlessConfig
from vlesshub.util import log

_API = "https://check-host.net/check-tcp"
_NODES = ("ru1.node.check-host.net", "de1.node.check-host.net")


def interpret(payload: object) -> str:
    """``multi`` when Russia and another node connect, ``ru`` for Russia only."""
    if not isinstance(payload, dict):
        return ""
    ru = False
    other = False
    for node, rows in payload.items():
        if not isinstance(node, str) or not _connected(rows):
            continue
        head = node.split(".", 1)[0]
        if head.startswith("ru"):
            ru = True
        else:
            other = True
    if ru and other:
        return "multi"
    if ru:
        return "ru"
    if other:
        return "other"
    return ""


def _connected(rows: object) -> bool:
    if not isinstance(rows, list) or not rows:
        return False
    first = rows[0]
    return isinstance(first, dict) and isinstance(first.get("time"), (int, float))


def annotate_vantage(configs: list[VlessConfig], limit: int, user_agent: str) -> None:
    if limit <= 0 or not configs:
        return
    sample = _sample(configs, limit)
    marks: dict[tuple[str, int], str] = {}
    misses = 0
    for cfg in sample:
        try:
            marks[(cfg.host, cfg.port)] = _check(cfg.host, cfg.port, user_agent)
            misses = 0
        except Exception as exc:  # noqa: BLE001
            misses += 1
            log(f"vantage {cfg.host}:{cfg.port} skipped: {exc}")
            if misses >= 3:
                log("vantage stopped after repeated check-host errors")
                break
        time.sleep(0.8)
    if not marks:
        return
    for cfg in configs:
        mark = marks.get((cfg.host, cfg.port), "")
        if mark:
            cfg.vantage = mark
    ru = sum(1 for mark in marks.values() if mark in {"ru", "multi"})
    log(f"vantage checked {len(marks)} addresses, russia {ru}")


def _sample(configs: list[VlessConfig], limit: int) -> list[VlessConfig]:
    groups: dict[str, list[VlessConfig]] = {}
    for cfg in configs:
        groups.setdefault(cfg.country or "ZZ", []).append(cfg)
    pools = [list(items) for items in groups.values()]
    picked: list[VlessConfig] = []
    seen: set[tuple[str, int]] = set()
    while len(picked) < limit and any(pools):
        for pool in pools:
            if not pool or len(picked) >= limit:
                continue
            cfg = pool.pop(0)
            key = (cfg.host, cfg.port)
            if key in seen:
                continue
            seen.add(key)
            picked.append(cfg)
    return picked


def _check(host: str, port: int, user_agent: str) -> str:
    query = [("host", f"{host}:{port}")]
    for node in _NODES:
        query.append(("node", node))
    url = f"{_API}?{urllib.parse.urlencode(query)}"
    started = _get_json(url, user_agent)
    request_id = started.get("request_id") if isinstance(started, dict) else ""
    if not request_id:
        return ""
    time.sleep(2.0)
    result = _get_json(f"https://check-host.net/check-result/{request_id}", user_agent)
    return interpret(result)


def _get_json(url: str, user_agent: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": user_agent})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}") from exc
    return payload if isinstance(payload, dict) else {}
