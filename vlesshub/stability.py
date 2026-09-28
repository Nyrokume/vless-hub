"""Per-config success bits published with the site, not committed on each run."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from vlesshub.stages import STABILITY_WINDOW, note_bits, success_rate
from vlesshub.util import log

PAGES_URL = "https://nyrokume.github.io/vless-hub/data/stability.json"
_MAX_ENTRIES = 40000


class Stability:
    def __init__(self, configs: dict[str, dict] | None = None, telegram: dict[str, dict] | None = None) -> None:
        self.configs = configs or {}
        self.telegram = telegram or {}

    @classmethod
    def load(cls, path: Path, *, fetch_url: str | None = PAGES_URL) -> Stability:
        payload = _read(path)
        if payload is None and fetch_url:
            payload = _fetch(fetch_url)
        if not isinstance(payload, dict):
            return cls()
        configs = payload.get("configs") if isinstance(payload.get("configs"), dict) else {}
        telegram = payload.get("telegram") if isinstance(payload.get("telegram"), dict) else {}
        return cls(configs=configs, telegram=telegram)

    def bits(self, fingerprint: str, *, telegram: bool = False) -> str:
        bucket = self.telegram if telegram else self.configs
        row = bucket.get(fingerprint)
        if not isinstance(row, dict):
            return ""
        return str(row.get("bits") or "")

    def seed(self, fingerprint: str, bits: str, *, telegram: bool = False) -> None:
        """Fill a missing row from the older git history so the first window is not empty."""
        if self.bits(fingerprint, telegram=telegram):
            return
        previous = "".join(char for char in bits if char in "01")[-STABILITY_WINDOW:]
        if not previous:
            return
        bucket = self.telegram if telegram else self.configs
        bucket[fingerprint] = {"bits": previous}

    def note(self, fingerprint: str, ok: bool, *, telegram: bool = False) -> str:
        bucket = self.telegram if telegram else self.configs
        row = bucket.get(fingerprint)
        if not isinstance(row, dict):
            row = {}
            bucket[fingerprint] = row
        row["bits"] = note_bits(str(row.get("bits") or ""), ok, STABILITY_WINDOW)
        return str(row["bits"])

    def rate(self, fingerprint: str, *, telegram: bool = False) -> float | None:
        return success_rate(self.bits(fingerprint, telegram=telegram))

    def save(self, path: Path) -> None:
        self._prune(self.configs)
        self._prune(self.telegram)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "configs": {key: self.configs[key] for key in sorted(self.configs)},
            "telegram": {key: self.telegram[key] for key in sorted(self.telegram)},
        }
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    def _prune(self, bucket: dict[str, dict]) -> None:
        overflow = len(bucket) - _MAX_ENTRIES
        if overflow <= 0:
            return
        ranked = sorted(bucket, key=lambda key: (str(bucket[key].get("bits") or "").count("1"), key))
        for key in ranked[:overflow]:
            bucket.pop(key, None)


def _read(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _fetch(url: str) -> dict | None:
    request = urllib.request.Request(url, headers={"User-Agent": "vless-hub"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        log(f"stability history unavailable: {exc}")
        return None
    if isinstance(payload, dict):
        log(f"stability history loaded from {url}")
        return payload
    return None
