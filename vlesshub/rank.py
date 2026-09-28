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
    """Prefer stable configs, keep room for new ones, and revive a few dead ones.

    Configs whose every source is deprioritized sort after healthy ones, so a
    near-zero subscription does not fill the probe budget.
    """
    if limit <= 0:
        return []
    blocked = deprioritized or set()

    def late(cfg: VlessConfig) -> int:
        if not cfg.sources:
            return 0
        return 1 if all(name in blocked for name in cfg.sources) else 0

    good: list[VlessConfig] = []
    fresh: list[VlessConfig] = []
    stale: list[VlessConfig] = []
    for cfg in configs:
        entry = history.get(cfg.fingerprint)
        if entry is None:
            fresh.append(cfg)
        elif int(entry.get("streak_fail", 0)) >= drop_after:
            stale.append(cfg)
        else:
            good.append(cfg)

    def good_key(cfg: VlessConfig) -> tuple[int, float, float]:
        entry = history.get(cfg.fingerprint) or {}
        uptime = history.uptime(cfg.fingerprint)
        ema = entry.get("ema_ms")
        # Sub-15 ms figures are leftover TCP connect times, not HTTP RTT.
        trusted = float(ema) if ema is not None and float(ema) >= 15 else 9_999.0
        return (late(cfg), -uptime, trusted)

    good.sort(key=good_key)
    fresh.sort(key=lambda cfg: (late(cfg), cfg.fingerprint))
    stale.sort(
        key=lambda cfg: (
            late(cfg),
            int((history.get(cfg.fingerprint) or {}).get("streak_fail", 0)),
            cfg.fingerprint,
        )
    )

    revival = min(len(stale), max(3, limit // 12))
    fresh_slots = min(len(fresh), max(5, limit // 3))
    good_slots = max(0, limit - revival - fresh_slots)
    if len(good) < good_slots:
        fresh_slots = min(len(fresh), fresh_slots + (good_slots - len(good)))
        good_slots = len(good)
    chosen = good[:good_slots] + fresh[:fresh_slots]
    used = {cfg.fingerprint for cfg in chosen}
    for cfg in stale:
        if len(chosen) >= good_slots + fresh_slots + revival:
            break
        if cfg.fingerprint not in used:
            chosen.append(cfg)
            used.add(cfg.fingerprint)
    if len(chosen) < limit:
        for pool in (good[good_slots:], fresh[fresh_slots:], stale):
            for cfg in pool:
                if len(chosen) >= limit:
                    break
                if cfg.fingerprint not in used:
                    chosen.append(cfg)
                    used.add(cfg.fingerprint)
    return chosen[:limit]


def rank_published(configs: list[VlessConfig]) -> list[VlessConfig]:
    def key(cfg: VlessConfig) -> tuple:
        latency = cfg.latency_ms if cfg.latency_ms is not None else 9_999_999
        verified_bonus = 0 if cfg.verified == "proxy" else 1
        return (verified_bonus, -cfg.uptime, latency, cfg.fingerprint)

    return sorted(configs, key=key)
