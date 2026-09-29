"""Full probe of the published list from the machine that runs this command."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from vlesshub.models import VlessConfig
from vlesshub.parser import parse_any

DEFAULT_LIST_URL = "https://nyrokume.github.io/vless-hub/data/configs.json"
_UA = "vless-hub/1.0 (+https://github.com/Nyrokume/vless-hub)"


def configs_from_hub(payload: object) -> list[VlessConfig]:
    """Keep rows whose uri parses. Junk and empty rows are dropped."""
    if not isinstance(payload, dict):
        return []
    rows = payload.get("configs")
    if not isinstance(rows, list):
        return []
    found: list[VlessConfig] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        uri = row.get("uri")
        if not isinstance(uri, str) or not uri.strip():
            continue
        cfg = parse_any(uri.strip(), source="local")
        if cfg is None:
            continue
        found.append(cfg)
    return found


def load_hub_payload(path: Path | None, url: str) -> object:
    if path is not None:
        return json.loads(path.read_text(encoding="utf-8"))
    request = urllib.request.Request(url, headers={"User-Agent": _UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def run_local_check(
    *,
    path: Path | None,
    url: str,
    out: Path,
    limit: int,
    concurrency: int,
    list_only: bool,
) -> int:
    try:
        payload = load_hub_payload(path, url)
    except Exception as exc:  # noqa: BLE001
        print(f"Не удалось прочитать список: {exc}")
        return 1
    configs = configs_from_hub(payload)
    if limit > 0:
        configs = configs[:limit]
    if not configs:
        print("В списке нет ссылок, которые удалось разобрать")
        return 1
    if list_only:
        for cfg in configs:
            print(f"{cfg.host}:{cfg.port}")
        return 0

    from vlesshub.probe import proxy_probe
    from vlesshub.tools import ensure_singbox, ensure_xray

    bin_dir = Path("bin")
    xray = ensure_xray(bin_dir)
    singbox = ensure_singbox(bin_dir)
    results = proxy_probe(
        configs,
        xray,
        timeout=6.0,
        speed_timeout=0.0,
        concurrency=max(1, concurrency),
        batch_size=8,
        singbox_bin=singbox,
    )
    working = [cfg for cfg in configs if (hit := results.get(cfg.fingerprint)) is not None and hit.ok]
    text = "\n".join(cfg.raw for cfg in working)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(f"{text}\n" if text else "", encoding="utf-8")
    print(f"Проверено {len(configs)}, работают {len(working)}")
    print(f"Рабочие ссылки записаны в {out}")
    for cfg in working:
        print(cfg.raw)
    return 0
