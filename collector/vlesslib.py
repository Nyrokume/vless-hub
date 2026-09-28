"""Parse public VLESS URIs into the structured records the site consumes."""

from __future__ import annotations

import base64
import hashlib
import re
from urllib.parse import parse_qs, unquote

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from countries import country_name

VLESS_RE = re.compile(r"vless://[^\s\"'<>]+", re.IGNORECASE)
REGIONAL = range(0x1F1E6, 0x1F1FF + 1)

DETAIL_KEYS = (
    "type",
    "security",
    "encryption",
    "flow",
    "sni",
    "fp",
    "pbk",
    "sid",
    "path",
    "host",
    "serviceName",
    "mode",
    "headerType",
    "alpn",
    "insecure",
    "allowInsecure",
    "spx",
)


def extract_flag_code(text: str) -> str | None:
    """Return the first regional-indicator flag in text as an ISO-like code."""
    letters: list[str] = []
    for char in text:
        code = ord(char)
        if code in REGIONAL:
            letters.append(chr(code - 0x1F1E6 + ord("A")))
            if len(letters) == 2:
                return "".join(letters)
        elif letters:
            letters.clear()
    return None


def _b64_decode(text: str) -> str | None:
    compact = "".join(text.split())
    if len(compact) < 16 or not re.fullmatch(r"[A-Za-z0-9+/=]+", compact):
        return None
    pad = "=" * (-len(compact) % 4)
    try:
        return base64.b64decode(compact + pad, validate=False).decode("utf-8", errors="ignore")
    except Exception:
        return None


def extract_vless_uris(payload: str) -> list[str]:
    """Pull vless:// links out of a subscription body, including base64 bodies."""
    text = payload.lstrip("\ufeff")
    if "vless://" not in text.lower():
        decoded = _b64_decode(text)
        if decoded and "vless://" in decoded.lower():
            text = decoded
    found: list[str] = []
    seen: set[str] = set()
    for match in VLESS_RE.findall(text):
        uri = match.strip()
        if uri not in seen:
            seen.add(uri)
            found.append(uri)
    return found


def _first(params: dict[str, list[str]], key: str) -> str:
    values = params.get(key) or params.get(key.lower()) or []
    return unquote(values[0]).strip() if values else ""


def parse_vless(uri: str, source_id: str = "") -> dict | None:
    if not uri.lower().startswith("vless://") or len(uri) > 8000:
        return None
    body = uri[8:]
    remark = ""
    if "#" in body:
        body, fragment = body.split("#", 1)
        remark = unquote(fragment).strip()
    query = ""
    if "?" in body:
        body, query = body.split("?", 1)
    if "@" not in body:
        return None
    user, hostport = body.rsplit("@", 1)
    user = unquote(user).strip()
    if not user or not hostport:
        return None
    hostport = hostport.strip()
    if hostport.startswith("["):
        end = hostport.find("]")
        if end < 0 or not hostport[end:].startswith("]:"):
            return None
        host = hostport[1:end]
        port_text = hostport[end + 2 :]
    else:
        if ":" not in hostport:
            return None
        host, port_text = hostport.rsplit(":", 1)
    host = host.strip().strip(".")
    if not host or any(ch.isspace() for ch in host):
        return None
    if host.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return None
    try:
        port = int(port_text)
    except ValueError:
        return None
    if port < 1 or port > 65535:
        return None

    params = parse_qs(query, keep_blank_values=True)
    transport = (_first(params, "type") or "tcp").lower()
    security = (_first(params, "security") or "none").lower() or "none"
    path = _first(params, "path")
    service_name = _first(params, "serviceName")
    sni = _first(params, "sni")
    extra = {key: _first(params, key) for key in DETAIL_KEYS if _first(params, key)}

    flag = extract_flag_code(remark)
    identity = "|".join(
        (
            user,
            host.lower(),
            str(port),
            transport,
            security,
            path,
            service_name,
            sni,
        )
    )
    return {
        "id": hashlib.sha256(identity.encode()).hexdigest()[:12],
        "uri": uri,
        "remark": remark,
        "uuid": user,
        "host": host,
        "port": port,
        "transport": transport,
        "security": security,
        "sni": sni,
        "flow": _first(params, "flow"),
        "path": path,
        "host_header": _first(params, "host"),
        "service_name": service_name,
        "fingerprint": _first(params, "fp"),
        "country_code": flag,
        "country": country_name(flag),
        "country_source": "remark" if flag else None,
        "ip_country_code": None,
        "ip_country": None,
        "extra": extra,
        "source": source_id,
    }


def dedupe(configs: list[dict]) -> list[dict]:
    """Keep one record per endpoint. Prefer a remark that already carries a flag."""
    chosen: dict[str, dict] = {}
    for config in configs:
        current = chosen.get(config["id"])
        if current is None:
            chosen[config["id"]] = config
            continue
        if not current.get("country_code") and config.get("country_code"):
            chosen[config["id"]] = config
    return list(chosen.values())
