from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from vlesshub.history import History
from vlesshub.models import VlessConfig
from vlesshub.parser import build_uri, parse_any
from vlesshub.stages import is_core

CARRY_MAX_AGE_SEC = 6 * 3600
BEST_LIMIT = 12
_BROWSER_SKIP = {"hysteria2", "hy2", "tuic"}
_READY_SECURITY = {"reality", "tls"}
_RU_VANTAGE = {"ru", "multi"}


def select_candidates(
    configs: list[VlessConfig],
    history: History,
    limit: int,
    drop_after: int,
    deprioritized: set[str] | None = None,
) -> list[VlessConfig]:
    """Retest the known-good pool first, then spend the rest on new candidates.

    Known-good rows are the ones whose last result was a pass. The oldest pass
    is first, so a short run refreshes configs before they age out. Configs
    whose every source is deprioritized sort after healthy ones. A long fail
    streak is left out of the pool entirely.
    """
    if limit <= 0:
        return []
    blocked = deprioritized or set()

    def late(cfg: VlessConfig) -> int:
        if not cfg.sources:
            return 0
        return 1 if all(name in blocked for name in cfg.sources) else 0

    def seen_at(cfg: VlessConfig) -> str:
        entry = history.get(cfg.fingerprint) or {}
        return str(entry.get("last_seen") or "")

    def last_ok(cfg: VlessConfig) -> str:
        entry = history.get(cfg.fingerprint) or {}
        return str(entry.get("last_ok") or "") or "9999"

    fresh: list[VlessConfig] = []
    proven: list[VlessConfig] = []
    retry: list[VlessConfig] = []
    for cfg in configs:
        entry = history.get(cfg.fingerprint)
        if entry is None:
            fresh.append(cfg)
            continue
        fails = int(entry.get("streak_fail", 0))
        if fails >= drop_after:
            continue
        if int(entry.get("ok", 0)) > 0 and fails == 0:
            proven.append(cfg)
        else:
            retry.append(cfg)

    fresh.sort(key=lambda cfg: (late(cfg), cfg.fingerprint))
    proven.sort(
        key=lambda cfg: (
            late(cfg),
            0 if _trusted_latency(history.get(cfg.fingerprint) or {}) is not None else 1,
            last_ok(cfg),
            cfg.fingerprint,
        )
    )
    retry.sort(key=lambda cfg: (late(cfg), seen_at(cfg), cfg.fingerprint))

    chosen: list[VlessConfig] = []
    used: set[str] = set()
    for pool in (proven, fresh, retry):
        for cfg in pool:
            if len(chosen) >= limit:
                return chosen
            if cfg.fingerprint in used:
                continue
            chosen.append(cfg)
            used.add(cfg.fingerprint)
    return chosen


def _trusted_latency(entry: dict) -> float | None:
    """HTTP RTT stored on a history row. Sub-15 ms values are old TCP connects."""
    for key in ("ema_ms", "latency_ms"):
        value = entry.get(key)
        if value is None:
            continue
        number = float(value)
        if number >= 15:
            return number
    return None


def _parse_stamp(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def carry_verified(
    configs: list[VlessConfig],
    history: History,
    already: set[str],
    max_age_sec: int = CARRY_MAX_AGE_SEC,
    now: datetime | None = None,
) -> list[VlessConfig]:
    """Keep a previous pass until a retest fails or the pass is older than max_age_sec."""
    moment = now or datetime.now(timezone.utc)
    carried: list[VlessConfig] = []
    for cfg in configs:
        if cfg.fingerprint in already:
            continue
        entry = history.get(cfg.fingerprint)
        if not entry:
            continue
        if int(entry.get("streak_fail", 0)) > 0 or int(entry.get("ok", 0)) <= 0:
            continue
        passed_at = _parse_stamp(str(entry.get("last_ok") or ""))
        if passed_at is None or (moment - passed_at).total_seconds() > max_age_sec:
            continue
        latency = _trusted_latency(entry)
        if latency is None:
            continue
        cfg.latency_ms = latency
        cfg.speed_kbps = None
        cfg.verified = "proxy"
        cfg.tested_at = passed_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        carried.append(cfg)
    return carried


def _bucket(cfg: VlessConfig) -> str:
    if cfg.network in {"ws", "grpc", "xhttp"}:
        return cfg.network
    if cfg.network == "httpupgrade":
        return "ws"
    if cfg.security == "reality":
        return "reality"
    if cfg.security == "tls":
        return "tls"
    return "other"


def reserve_diverse(
    configs: list[VlessConfig],
    history: History,
    limit: int,
    drop_after: int,
    deprioritized: set[str] | None = None,
) -> list[VlessConfig]:
    """Keep a slice of each connection type before filling the rest of the budget."""
    if limit <= 0:
        return []
    groups: dict[str, list[VlessConfig]] = {}
    for cfg in configs:
        groups.setdefault(_bucket(cfg), []).append(cfg)
    floor = max(2, limit // 8)
    chosen: list[VlessConfig] = []
    used: set[str] = set()
    for name in ("reality", "tls", "ws", "grpc", "xhttp", "other"):
        pool = groups.get(name) or []
        if not pool or len(chosen) >= limit:
            continue
        take = min(len(pool), floor, limit - len(chosen))
        for cfg in select_candidates(pool, history, take, drop_after, deprioritized):
            if cfg.fingerprint in used:
                continue
            chosen.append(cfg)
            used.add(cfg.fingerprint)
    if len(chosen) < limit:
        rest = [cfg for cfg in configs if cfg.fingerprint not in used]
        for cfg in select_candidates(rest, history, limit - len(chosen), drop_after, deprioritized):
            if cfg.fingerprint in used:
                continue
            chosen.append(cfg)
            used.add(cfg.fingerprint)
            if len(chosen) >= limit:
                break
    return chosen


def mix_proxy_targets(
    tcp_ok: list[VlessConfig],
    hysteria: list[VlessConfig],
    history: History,
    limit: int,
    drop_after: int,
    deprioritized: set[str] | None = None,
) -> list[VlessConfig]:
    """Give Hysteria2 its own slice of the proxy budget, then fill with TCP-open configs."""
    if limit <= 0:
        return []
    reserved = len(hysteria) if len(hysteria) <= max(8, limit // 8) else max(8, limit // 8)
    hy2_chosen = select_candidates(hysteria, history, min(reserved, limit), drop_after, deprioritized)
    rest = reserve_diverse(
        tcp_ok,
        history,
        limit - len(hy2_chosen),
        drop_after,
        deprioritized,
    )
    return hy2_chosen + rest


def _probeable(cfg: VlessConfig) -> bool:
    return (cfg.protocol or "vless").lower() not in _BROWSER_SKIP


def _from_russia(cfg: VlessConfig) -> bool:
    return cfg.port == 443 and (cfg.security or "") in _READY_SECURITY and cfg.vantage in _RU_VANTAGE


def _tls_443(cfg: VlessConfig) -> bool:
    return cfg.port == 443 and (cfg.security or "") in _READY_SECURITY


def rank_published(configs: list[VlessConfig]) -> list[VlessConfig]:
    """Port 443 with Reality or TLS that opened from Russia, then the stable core, then ping."""

    def key(cfg: VlessConfig) -> tuple:
        latency = cfg.latency_ms if cfg.latency_ms is not None else 9_999_999
        verified_bonus = 0 if cfg.verified == "proxy" else 1
        vantage = {"multi": 0, "ru": 1}.get(cfg.vantage, 2)
        core = 0 if is_core(cfg.bits) else 1
        ready = 0 if _from_russia(cfg) else 1
        return (ready, core, verified_bonus, latency, vantage, -cfg.uptime, cfg.fingerprint)

    return sorted(configs, key=key)


def select_best(configs: list[VlessConfig], limit: int = BEST_LIMIT) -> list[VlessConfig]:
    """A short list the browser and a phone can try first.

    Prefer different hosts on port 443 with Reality or TLS that opened from Russia.
    If this run has any browser-checkable config, the list is never empty.
    """
    if limit <= 0:
        return []
    pool = [cfg for cfg in configs if _probeable(cfg)]
    if not pool:
        return []
    preferred = [cfg for cfg in pool if _from_russia(cfg)]
    if not preferred:
        preferred = [cfg for cfg in pool if _tls_443(cfg)]
    if not preferred:
        preferred = pool

    def key(cfg: VlessConfig) -> tuple:
        latency = cfg.latency_ms if cfg.latency_ms is not None else 9_999_999
        vantage = {"multi": 0, "ru": 1}.get(cfg.vantage, 2)
        core = 0 if is_core(cfg.bits) else 1
        return (core, vantage, latency, cfg.fingerprint)

    ordered = sorted(preferred, key=key)
    chosen: list[VlessConfig] = []
    hosts: set[str] = set()
    for cfg in ordered:
        if len(chosen) >= limit:
            break
        host = cfg.host.lower()
        if host in hosts:
            continue
        hosts.add(host)
        chosen.append(cfg)
    if len(chosen) < limit:
        for cfg in ordered:
            if len(chosen) >= limit:
                break
            if any(cfg.fingerprint == item.fingerprint for item in chosen):
                continue
            chosen.append(cfg)
    return chosen


def save_best(path: Path, configs: list[VlessConfig], saved_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for cfg in configs:
        rows.append(
            {
                "uri": build_uri(cfg),
                "latency_ms": cfg.latency_ms,
                "bits": cfg.bits,
                "vantage": cfg.vantage,
                "country": cfg.country,
                "country_name": cfg.country_name,
                "verified": cfg.verified or "proxy",
                "core": cfg.core,
                "uptime": cfg.uptime,
            }
        )
    path.write_text(
        json.dumps({"saved_at": saved_at, "configs": rows}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_best(path: Path, closed: set[tuple[str, int]] | None = None) -> list[VlessConfig]:
    """Last short list, without addresses Russia has since refused."""
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = payload.get("configs") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    blocked = closed or set()
    restored: list[VlessConfig] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        cfg = parse_any(str(row.get("uri") or ""))
        if cfg is None or (cfg.host, cfg.port) in blocked or cfg.fingerprint in seen:
            continue
        seen.add(cfg.fingerprint)
        latency = row.get("latency_ms")
        cfg.latency_ms = float(latency) if isinstance(latency, (int, float)) else None
        cfg.bits = str(row.get("bits") or "")
        cfg.vantage = str(row.get("vantage") or "")
        cfg.country = str(row.get("country") or cfg.country)
        cfg.country_name = str(row.get("country_name") or cfg.country_name)
        cfg.verified = str(row.get("verified") or "proxy")
        cfg.core = str(row.get("core") or "")
        try:
            cfg.uptime = float(row.get("uptime") or 0)
        except (TypeError, ValueError):
            cfg.uptime = 0
        restored.append(cfg)
    return restored


def apply_best(
    published: list[VlessConfig],
    path: Path,
    closed: set[tuple[str, int]],
    saved_at: str,
    limit: int = BEST_LIMIT,
) -> tuple[list[VlessConfig], list[VlessConfig]]:
    """Return the shared list and the short list.

    When this run has no browser-checkable config, the previous short list is
    appended so the site and the subscription are not empty. A refusal from
    Russia is not brought back. An empty result does not erase the saved file.
    """
    best = select_best(published, limit)
    if best:
        save_best(path, best, saved_at)
        return published, best
    restored = load_best(path, closed)
    if not restored:
        return published, []
    have = {cfg.fingerprint for cfg in published}
    extra = [cfg for cfg in restored if cfg.fingerprint not in have]
    merged = rank_published(list(published) + extra) if extra else list(published)
    best = select_best(merged, limit) or restored[:limit]
    save_best(path, best, saved_at)
    return merged, best
