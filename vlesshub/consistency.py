"""The published files must be the same verified set as data/configs.json."""

from __future__ import annotations

import base64
import json
import re
from collections import Counter
from pathlib import Path

import yaml

_TOKEN = re.compile(
    r"(?:vless|vmess|trojan|ss|hy2|hysteria2|tuic|tg|socks5?)://[^\s\"'<>]+"
    r"|https?://(?:t\.me|telegram\.me)/(?:proxy|socks)\?[^\s\"'<>]+",
    re.IGNORECASE,
)
_SKIP_JSON = {"direct", "selector", "urltest", "block", "dns"}


def check_publish(out_dir: Path) -> list[str]:
    """Return human-readable mismatches. An empty list means the tree matches."""
    hub_path = out_dir / "data" / "configs.json"
    if not hub_path.is_file():
        return [f"missing {hub_path}"]
    hub = json.loads(hub_path.read_text(encoding="utf-8"))
    configs = hub.get("configs") if isinstance(hub, dict) else None
    proxies = hub.get("proxies") if isinstance(hub, dict) else None
    if not isinstance(configs, list) or not isinstance(proxies, list):
        return ["data/configs.json has no configs list"]
    errors: list[str] = []
    for key in ("unverified", "unstable", "unstable_proxies"):
        extra = hub.get(key) or []
        if extra:
            errors.append(f"data/configs.json {key} has {len(extra)} rows")
    config_uris = [_bare(str(item.get("uri") or "")) for item in configs if isinstance(item, dict)]
    if any(not uri for uri in config_uris):
        errors.append("a config is missing its uri")
    config_set = set(config_uris)
    if len(config_set) != len(config_uris):
        errors.append("configs.json repeats a uri")
    allowed_config = set(config_uris)
    tg_links = [_bare(str(item.get("tg") or "")) for item in proxies if isinstance(item, dict)]
    https_links = [_bare(str(item.get("https") or "")) for item in proxies if isinstance(item, dict)]
    allowed = allowed_config | set(tg_links) | set(https_links)
    config_keys = Counter(_endpoint(item) for item in configs if isinstance(item, dict))

    for path in _files(out_dir):
        relative = path.relative_to(out_dir).as_posix()
        if path.suffix == ".json" and path.name != "singbox.json":
            text = path.read_text(encoding="utf-8")
            errors.extend(_tokens_in_text(relative, text, allowed))
            continue
        if path.name in {"clash.yaml", "clash.yml"}:
            errors.extend(_clash(relative, path, config_keys))
            continue
        if path.name == "singbox.json":
            errors.extend(_singbox(relative, path, config_keys))
            continue
        text = path.read_text(encoding="utf-8")
        if _is_base64_file(relative):
            try:
                text = base64.b64decode(text.strip()).decode("utf-8")
            except (ValueError, UnicodeError) as exc:
                errors.append(f"{relative} is not base64: {exc}")
                continue
            relative = f"{relative} (decoded)"
        errors.extend(_lines(relative, text, allowed))

    errors.extend(_exact("sub/all.txt", out_dir, config_set))
    errors.extend(_exact("data/subs/all.txt", out_dir, config_set))
    errors.extend(_exact("tg/all.txt", out_dir, set(tg_links)))
    errors.extend(_exact("tg/https.txt", out_dir, set(https_links)))
    api = out_dir / "api" / "configs.json"
    if api.is_file():
        payload = json.loads(api.read_text(encoding="utf-8"))
        api_uris = {
            _bare(str(item.get("uri") or ""))
            for item in (payload.get("configs") or [])
            if isinstance(item, dict)
        }
        if api_uris != config_set:
            errors.append("api/configs.json uri set differs from data/configs.json")
        if payload.get("unverified"):
            errors.append("api/configs.json still lists unverified configs")
    return errors


def _exact(relative: str, out_dir: Path, expected: set[str]) -> list[str]:
    path = out_dir / relative
    if not path.is_file():
        return [f"missing {relative}"]
    found = _proxy_lines(path.read_text(encoding="utf-8"))
    if set(found) != expected or len(found) != len(expected):
        return [f"{relative} has {len(found)} links, list has {len(expected)}"]
    return []


def _files(out_dir: Path):
    roots = [out_dir / name for name in ("sub", "data", "tg", "api")]
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix in {".txt", ".yaml", ".yml", ".json"}:
                yield path


def _is_base64_file(relative: str) -> bool:
    return relative.endswith(".b64.txt") or relative.startswith("sub/base64/")


def _lines(relative: str, text: str, allowed: set[str]) -> list[str]:
    errors: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            if "://" in line:
                errors.append(f"{relative}:{number} comment contains a link")
            continue
        bare = _bare(line)
        if bare not in allowed:
            errors.append(f"{relative}:{number} is not in the verified list")
    return errors


def _tokens_in_text(relative: str, text: str, allowed: set[str]) -> list[str]:
    errors: list[str] = []
    for match in _TOKEN.finditer(text):
        bare = _bare(match.group(0))
        if bare not in allowed:
            errors.append(f"{relative} contains a link that is not in the verified list")
            break
    return errors


def _proxy_lines(text: str) -> list[str]:
    found: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        found.append(_bare(line))
    return found


def _bare(value: str) -> str:
    token = value.strip().strip("\"'").rstrip(",;")
    return token.split("#", 1)[0]


def _endpoint(item: dict) -> tuple[str, int, str]:
    host = str(item.get("host") or "")
    port = int(item.get("port") or 0)
    ident = str(item.get("uuid") or item.get("password") or "")
    return host, port, ident


def _clash(relative: str, path: Path, expected: Counter) -> list[str]:
    document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    proxies = document.get("proxies") if isinstance(document, dict) else None
    if not isinstance(proxies, list):
        return [f"{relative} has no proxies"]
    found = Counter(
        (str(item.get("server") or ""), int(item.get("port") or 0), str(item.get("uuid") or item.get("password") or ""))
        for item in proxies
        if isinstance(item, dict)
    )
    if found != expected:
        return [f"{relative} proxy set differs from configs"]
    return []


def _singbox(relative: str, path: Path, expected: Counter) -> list[str]:
    document = json.loads(path.read_text(encoding="utf-8"))
    outbounds = document.get("outbounds") if isinstance(document, dict) else None
    if not isinstance(outbounds, list):
        return [f"{relative} has no outbounds"]
    found: Counter = Counter()
    for item in outbounds:
        if not isinstance(item, dict) or item.get("type") in _SKIP_JSON:
            continue
        found[(
            str(item.get("server") or ""),
            int(item.get("server_port") or 0),
            str(item.get("uuid") or item.get("password") or ""),
        )] += 1
    if found != expected:
        return [f"{relative} outbound set differs from configs"]
    return []
