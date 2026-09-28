"""Remember which subscription sources actually produce working configs."""

from __future__ import annotations

import json
from pathlib import Path

from vlesshub.models import SourceReport, VlessConfig

MIN_SAMPLE = 8
NEAR_ZERO = 0.02
STREAK_LIMIT = 2


def load_health(path: Path) -> dict:
    if not path.is_file():
        return {"sources": {}}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"sources": {}}
    sources = raw.get("sources") if isinstance(raw, dict) else None
    if not isinstance(sources, dict):
        return {"sources": {}}
    return {"sources": sources}


def save_health(path: Path, health: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(health, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def deprioritized_names(health: dict) -> set[str]:
    blocked: set[str] = set()
    for name, row in health.get("sources", {}).items():
        if isinstance(row, dict) and int(row.get("zero_streak", 0)) >= STREAK_LIMIT:
            blocked.add(str(name))
    return blocked


def note_yield(health: dict, name: str, tested: int, verified: int) -> dict:
    sources = health.setdefault("sources", {})
    row = dict(sources.get(name) or {})
    row["tested"] = tested
    row["verified"] = verified
    ratio = (verified / tested) if tested else None
    row["yield"] = None if ratio is None else round(ratio, 4)
    streak = int(row.get("zero_streak", 0))
    if tested >= MIN_SAMPLE:
        near_zero = verified == 0 or (tested >= 20 and (verified / tested) < NEAR_ZERO)
        streak = streak + 1 if near_zero else 0
    row["zero_streak"] = streak
    row["deprioritized"] = streak >= STREAK_LIMIT
    sources[name] = row
    return row


def apply_source_health(
    reports: list[SourceReport],
    evaluated: list[tuple[VlessConfig, bool]],
    health: dict,
) -> None:
    """Stamp yield onto this run's reports and advance the near-zero streak."""
    names = {report.name for report in reports}
    tested_counts = {name: 0 for name in names}
    verified_counts = {name: 0 for name in names}
    for cfg, ok in evaluated:
        for name in cfg.sources:
            if name not in tested_counts:
                continue
            tested_counts[name] += 1
            if ok:
                verified_counts[name] += 1
    known = health.get("sources", {})
    for report in reports:
        tested = tested_counts[report.name]
        verified = verified_counts[report.name]
        if tested == 0:
            previous = known.get(report.name) if isinstance(known, dict) else None
            report.tested = 0
            report.verified = 0
            if isinstance(previous, dict):
                report.yield_ratio = previous.get("yield")
                report.deprioritized = bool(previous.get("deprioritized"))
            continue
        row = note_yield(health, report.name, tested, verified)
        report.tested = tested
        report.verified = verified
        report.yield_ratio = row["yield"]
        report.deprioritized = bool(row["deprioritized"])
