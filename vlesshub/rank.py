from __future__ import annotations

from vlesshub.history import History
from vlesshub.models import VlessConfig


def select_candidates(
    configs: list[VlessConfig],
    history: History,
    limit: int,
    drop_after: int,
    deprioritized: set[str] | None = None,
) -> list[VlessConfig]:
    """Rotate through the pool so untouched configs are tested before recent failures.

    A slice of the budget rechecks known-good configs, oldest first. Configs
    whose every source is deprioritized sort after healthy ones.
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

    fresh: list[VlessConfig] = []
    proven: list[VlessConfig] = []
    retry: list[VlessConfig] = []
    stale: list[VlessConfig] = []
    for cfg in configs:
        entry = history.get(cfg.fingerprint)
        if entry is None:
            fresh.append(cfg)
            continue
        fails = int(entry.get("streak_fail", 0))
        if fails >= drop_after:
            stale.append(cfg)
        elif int(entry.get("ok", 0)) > 0 and fails == 0:
            proven.append(cfg)
        else:
            retry.append(cfg)

    fresh.sort(key=lambda cfg: (late(cfg), cfg.fingerprint))
    proven.sort(
        key=lambda cfg: (
            late(cfg),
            0 if _trusted_latency(history.get(cfg.fingerprint) or {}) is not None else 1,
            seen_at(cfg),
            cfg.fingerprint,
        )
    )
    retry.sort(key=lambda cfg: (late(cfg), seen_at(cfg), cfg.fingerprint))
    stale.sort(key=lambda cfg: (late(cfg), seen_at(cfg), cfg.fingerprint))

    fresh_slots = min(len(fresh), max(1, (limit * 3) // 5)) if fresh else 0
    proven_slots = min(len(proven), max(1, limit // 5)) if proven else 0
    if fresh_slots + proven_slots > limit:
        fresh_slots = min(fresh_slots, limit)
        proven_slots = min(proven_slots, max(0, limit - fresh_slots))
    chosen = fresh[:fresh_slots] + proven[:proven_slots]
    used = {cfg.fingerprint for cfg in chosen}
    for pool in (fresh[fresh_slots:], retry, proven[proven_slots:], stale):
        for cfg in pool:
            if len(chosen) >= limit:
                return chosen
            if cfg.fingerprint not in used:
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


def carry_verified(
    configs: list[VlessConfig],
    history: History,
    already: set[str],
) -> list[VlessConfig]:
    """Keep earlier proxy successes that were not retested or failed this run."""
    carried: list[VlessConfig] = []
    for cfg in configs:
        if cfg.fingerprint in already:
            continue
        entry = history.get(cfg.fingerprint)
        if not entry:
            continue
        if int(entry.get("streak_fail", 0)) > 0 or int(entry.get("ok", 0)) <= 0:
            continue
        latency = _trusted_latency(entry)
        if latency is None:
            continue
        cfg.latency_ms = latency
        cfg.speed_kbps = None
        cfg.verified = "proxy"
        carried.append(cfg)
    return carried


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
    rest = select_candidates(
        tcp_ok,
        history,
        limit - len(hy2_chosen),
        drop_after,
        deprioritized,
    )
    return hy2_chosen + rest


def rank_published(configs: list[VlessConfig]) -> list[VlessConfig]:
    """Proxy-verified first, then measured ping. The full list is returned."""

    def key(cfg: VlessConfig) -> tuple:
        latency = cfg.latency_ms if cfg.latency_ms is not None else 9_999_999
        verified_bonus = 0 if cfg.verified == "proxy" else 1
        return (verified_bonus, latency, -cfg.uptime, cfg.fingerprint)

    return sorted(configs, key=key)
