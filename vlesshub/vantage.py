"""TCP checks from check-host.net. A completed refusal in Russia is not published."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from vlesshub.models import VlessConfig
from vlesshub.util import log

_API = "https://check-host.net/check-tcp"
_RU_NODES = (
    "ru1.node.check-host.net",
    "ru2.node.check-host.net",
    "ru3.node.check-host.net",
)
_OTHER_NODES = (
    "de1.node.check-host.net",
    "nl1.node.check-host.net",
    "fi1.node.check-host.net",
)


class RateLimited(RuntimeError):
    """check-host asked us to slow down. The address was not judged."""


@dataclass
class VantageScan:
    checked: int = 0
    open: int = 0
    closed: int = 0
    unknown: int = 0
    closed_endpoints: set[tuple[str, int]] = field(default_factory=set)


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


def russia_verdict(payload: object) -> str:
    """``open`` when a Russia node connected, ``closed`` when every Russia node finished without a connection.

    ``unknown`` means the answer was missing or still pending. That is not a refusal.
    """
    if not isinstance(payload, dict):
        return "unknown"
    saw_ru = False
    pending = False
    for node, rows in payload.items():
        if not isinstance(node, str) or not node.split(".", 1)[0].startswith("ru"):
            continue
        saw_ru = True
        if rows is None or not isinstance(rows, list):
            pending = True
            continue
        if _connected(rows):
            return "open"
    if not saw_ru or pending:
        return "unknown"
    return "closed"


def annotate_vantage(
    configs: list[VlessConfig],
    limit: int,
    user_agent: str,
    budget_sec: float = 240.0,
) -> VantageScan:
    scan = VantageScan()
    if limit <= 0 or not configs or budget_sec <= 0:
        return scan
    sample = _sample(configs, limit)
    marks: dict[tuple[str, int], str] = {}
    deadline = time.monotonic() + budget_sec
    backoff = 5.0
    index = 0
    while index < len(sample):
        if time.monotonic() >= deadline:
            log("vantage stopped: time budget")
            break
        cfg = sample[index]
        ru_node = _RU_NODES[index % len(_RU_NODES)]
        other_node = _OTHER_NODES[index % len(_OTHER_NODES)]
        try:
            mark, verdict = _check(cfg.host, cfg.port, user_agent, ru_node, other_node)
        except RateLimited:
            wait = min(backoff, max(0.0, deadline - time.monotonic()))
            log(f"vantage rate limit, wait {wait:.0f}s")
            if wait <= 0:
                break
            time.sleep(wait)
            backoff = min(backoff * 2, 30.0)
            continue
        except Exception as exc:  # noqa: BLE001
            log(f"vantage {cfg.host}:{cfg.port} skipped: {exc}")
            scan.unknown += 1
            index += 1
            time.sleep(1.1)
            continue
        backoff = 5.0
        index += 1
        key = (cfg.host, cfg.port)
        scan.checked += 1
        if verdict == "open":
            scan.open += 1
            if mark in {"ru", "multi"}:
                marks[key] = mark
        elif verdict == "closed":
            scan.closed += 1
            scan.closed_endpoints.add(key)
        else:
            scan.unknown += 1
        pause = min(1.1, max(0.0, deadline - time.monotonic()))
        if pause > 0 and index < len(sample):
            time.sleep(pause)
    for cfg in configs:
        mark = marks.get((cfg.host, cfg.port), "")
        if mark:
            cfg.vantage = mark
    log(
        f"vantage checked {scan.checked} open {scan.open} "
        f"closed {scan.closed} unknown {scan.unknown}"
    )
    return scan


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


def _check(host: str, port: int, user_agent: str, ru_node: str, other_node: str) -> tuple[str, str]:
    query = [("host", f"{host}:{port}"), ("node", ru_node), ("node", other_node)]
    url = f"{_API}?{urllib.parse.urlencode(query)}"
    started = _get_json(url, user_agent)
    request_id = started.get("request_id") if isinstance(started, dict) else ""
    if not request_id:
        return "", "unknown"
    result: dict = {}
    for _ in range(4):
        time.sleep(1.5)
        result = _get_json(f"https://check-host.net/check-result/{request_id}", user_agent)
        if result and all(value is not None for value in result.values()):
            break
    return interpret(result), russia_verdict(result)


def _get_json(url: str, user_agent: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": user_agent})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in {429, 503}:
            raise RateLimited(f"HTTP {exc.code}") from exc
        raise RuntimeError(f"HTTP {exc.code}") from exc
    return payload if isinstance(payload, dict) else {}
