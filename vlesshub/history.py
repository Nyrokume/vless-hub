from __future__ import annotations

import json
from pathlib import Path

from vlesshub.util import utcnow


def _blank_entry() -> dict:
    return {
        "ok": 0,
        "fail": 0,
        "streak_ok": 0,
        "streak_fail": 0,
        "last_ok": None,
        "last_fail": None,
        "last_seen": None,
        "latency_ms": None,
        "ema_ms": None,
        "bits": "",
        "miss": 0,
        "country": "",
    }


class History:
    def __init__(self, entries: dict[str, dict] | None = None, updated: str | None = None) -> None:
        self.entries: dict[str, dict] = entries or {}
        self.updated = updated

    @classmethod
    def load(cls, path: Path) -> History:
        if not path.is_file():
            return cls()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return cls()
        entries = payload.get("entries") if isinstance(payload, dict) else None
        if not isinstance(entries, dict):
            return cls()
        return cls(entries=entries, updated=payload.get("updated"))

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.updated = utcnow()
        payload = {
            "version": 1,
            "updated": self.updated,
            "entries": {key: self.entries[key] for key in sorted(self.entries)},
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def get(self, fingerprint: str) -> dict | None:
        entry = self.entries.get(fingerprint)
        return entry if isinstance(entry, dict) else None

    def uptime(self, fingerprint: str) -> float:
        entry = self.get(fingerprint)
        if not entry:
            return 0.0
        total = int(entry.get("ok", 0)) + int(entry.get("fail", 0))
        if total <= 0:
            return 0.0
        return int(entry.get("ok", 0)) / total

    def excluded(self, fingerprint: str, drop_after: int) -> bool:
        entry = self.get(fingerprint)
        if not entry:
            return False
        return int(entry.get("streak_fail", 0)) >= drop_after

    def has_success(self) -> bool:
        return any(int(entry.get("ok", 0)) > 0 for entry in self.entries.values() if isinstance(entry, dict))

    def mark_misses(self, seen: set[str]) -> None:
        for fingerprint, entry in self.entries.items():
            if fingerprint not in seen:
                entry["miss"] = int(entry.get("miss", 0)) + 1

    def seen(self, fingerprint: str) -> dict:
        """Remember a config without counting a success or a failure.

        Used when TCP reached the port but Xray did not test it this run.
        """
        entry = self.get(fingerprint)
        if entry is None:
            entry = _blank_entry()
            self.entries[fingerprint] = entry
        entry["last_seen"] = utcnow()
        entry["miss"] = 0
        return entry

    def record(
        self,
        fingerprint: str,
        *,
        ok: bool,
        latency_ms: float | None,
        country: str = "",
    ) -> dict:
        entry = self.get(fingerprint)
        if entry is None:
            entry = _blank_entry()
            self.entries[fingerprint] = entry
        now = utcnow()
        entry["last_seen"] = now
        entry["miss"] = 0
        bit = "1" if ok else "0"
        entry["bits"] = (str(entry.get("bits") or "") + bit)[-24:]
        if ok:
            entry["ok"] = int(entry.get("ok", 0)) + 1
            entry["streak_ok"] = int(entry.get("streak_ok", 0)) + 1
            entry["streak_fail"] = 0
            entry["last_ok"] = now
            if latency_ms is not None:
                latency = round(float(latency_ms), 1)
                entry["latency_ms"] = latency
                previous = entry.get("ema_ms")
                # Values under 15 ms are TCP-connect artifacts from older runs.
                if previous is None or float(previous) < 15:
                    entry["ema_ms"] = latency
                else:
                    entry["ema_ms"] = round(float(previous) * 0.7 + latency * 0.3, 1)
        else:
            entry["fail"] = int(entry.get("fail", 0)) + 1
            entry["streak_fail"] = int(entry.get("streak_fail", 0)) + 1
            entry["streak_ok"] = 0
            entry["last_fail"] = now
        if country:
            entry["country"] = country
        return entry

    def apply_to(self, fingerprint: str, target: object) -> None:
        entry = self.get(fingerprint)
        if not entry:
            return
        total = int(entry.get("ok", 0)) + int(entry.get("fail", 0))
        target.uptime = (int(entry.get("ok", 0)) / total) if total else 0.0
        target.checks_ok = int(entry.get("ok", 0))
        target.checks_fail = int(entry.get("fail", 0))
        target.bits = str(entry.get("bits") or "")

    def prune(self, drop_after: int, max_entries: int = 40000) -> None:
        remove = [
            fingerprint
            for fingerprint, entry in self.entries.items()
            if int(entry.get("miss", 0)) >= 10
            or (
                int(entry.get("streak_fail", 0)) >= drop_after + 4
                and int(entry.get("ok", 0)) == 0
            )
            or int(entry.get("streak_fail", 0)) >= drop_after + 8
        ]
        for fingerprint in remove:
            self.entries.pop(fingerprint, None)
        overflow = len(self.entries) - max_entries
        if overflow <= 0:
            return
        ranked = sorted(
            self.entries,
            key=lambda fingerprint: (
                int(self.entries[fingerprint].get("streak_fail", 0)),
                int(self.entries[fingerprint].get("miss", 0)),
            ),
            reverse=True,
        )
        for fingerprint in ranked[:overflow]:
            self.entries.pop(fingerprint, None)
