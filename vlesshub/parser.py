"""Parse vless:// URIs and subscription blobs.

Fingerprints ignore the remark and use this field order, joined by ``|``:

uuid, host, port, security, sni, pbk, sid, flow, network, path, host_header,
service_name, mode, encryption, alpn, header_type, packet_encoding,
allow_insecure (1/0), spx, authority, extra, extras (k=v&k=v, sorted).

uuid/host/sni/host_header/alpn/header_type/packet_encoding/security/network
are lowercased. The inspector in ``site/src/lib/vless.ts`` must stay in lockstep.
"""

from __future__ import annotations

import base64
import hashlib
import html
import re
from urllib.parse import quote, unquote, urlencode

from vlesshub.models import VlessConfig

VLESS_RE = re.compile(r"vless://[^\s<>\"'`]+", re.IGNORECASE)
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_TRAIL = ".,;)]}>\"'"
_IGNORE_KEYS = {"remarks", "remark", "ps", "name", "tag"}

_NETWORK_ALIASES = {
    "tcp": "tcp",
    "raw": "tcp",
    "ws": "ws",
    "websocket": "ws",
    "grpc": "grpc",
    "gun": "grpc",
    "h2": "h2",
    "http": "h2",
    "http2": "h2",
    "xhttp": "xhttp",
    "splithttp": "xhttp",
    "httpupgrade": "httpupgrade",
    "kcp": "kcp",
    "mkcp": "kcp",
    "quic": "quic",
}

_SECURITY_ALIASES = {
    "none": "none",
    "": "none",
    "false": "none",
    "0": "none",
    "no": "none",
    "off": "none",
    "tls": "tls",
    "reality": "reality",
    "xtls": "tls",
}


def extract_flag_code(text: str) -> str:
    """Return the first regional-indicator flag as an ISO alpha-2 code."""
    letters: list[str] = []
    for char in text or "":
        code = ord(char)
        if 0x1F1E6 <= code <= 0x1F1FF:
            letters.append(chr(code - 0x1F1E6 + ord("A")))
            if len(letters) == 2:
                return "".join(letters)
        elif letters:
            letters.clear()
    return ""


def is_uuid(value: str) -> bool:
    return bool(UUID_RE.match(value))


def normalize_network(value: str) -> str:
    key = (value or "tcp").strip().lower()
    return _NETWORK_ALIASES.get(key, key or "tcp")


def normalize_security(value: str) -> str:
    key = (value or "none").strip().lower()
    return _SECURITY_ALIASES.get(key, key or "none")


def fingerprint(cfg: VlessConfig) -> str:
    return hashlib.sha256(fingerprint_material(cfg).encode("utf-8")).hexdigest()[:16]


def fingerprint_material(cfg: VlessConfig) -> str:
    extras = "&".join(f"{key}={cfg.extras[key]}" for key in sorted(cfg.extras))
    parts = [
        cfg.uuid.lower(),
        cfg.host.lower(),
        str(cfg.port),
        normalize_security(cfg.security),
        cfg.sni.lower(),
        cfg.pbk,
        cfg.sid,
        cfg.flow,
        normalize_network(cfg.network),
        cfg.path,
        cfg.host_header.lower(),
        cfg.service_name,
        cfg.mode,
        (cfg.encryption or "none").lower(),
        cfg.alpn.lower(),
        cfg.header_type.lower(),
        cfg.packet_encoding.lower(),
        "1" if cfg.allow_insecure else "0",
        cfg.spx,
        cfg.authority.lower(),
        cfg.extra,
        extras,
    ]
    return "|".join(parts)


def extract_vless_uris(text: str) -> list[str]:
    """Pull vless:// URIs out of plain text, HTML, or a base64 subscription."""
    text = html.unescape(text or "")
    text = text.replace("\ufeff", "").replace("\\u0026", "&").replace("\\/", "/")
    found: list[str] = []
    seen: set[str] = set()

    def add_from(blob: str) -> None:
        for match in VLESS_RE.findall(blob):
            uri = _clean_uri(match)
            if uri.lower().startswith("vless://") and uri not in seen:
                seen.add(uri)
                found.append(uri)

    add_from(text)
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "://" in stripped:
            continue
        decoded = _b64_decode_text(stripped)
        if decoded:
            add_from(decoded)
    if not found:
        decoded = _b64_decode_text(text)
        if decoded:
            add_from(decoded)
            for line in decoded.splitlines():
                stripped = line.strip()
                if not stripped or "://" in stripped:
                    continue
                nested = _b64_decode_text(stripped)
                if nested:
                    add_from(nested)
    return found


def parse_vless(uri: str, source: str = "") -> VlessConfig | None:
    cleaned = _clean_uri(html.unescape(uri.strip()))
    if not cleaned.lower().startswith("vless://"):
        return None
    body = cleaned[len("vless://") :]
    remark = ""
    if "#" in body:
        body, fragment = body.split("#", 1)
        remark = _unquote_repeat(fragment).strip()
    query = ""
    if "?" in body:
        body, query = body.split("?", 1)
    if "@" not in body:
        return None
    user, hostport = body.rsplit("@", 1)
    user = unquote(user).strip()
    host, port = _split_host_port(hostport.strip())
    if not user or not host or port is None:
        return None
    if host.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return None
    cfg = VlessConfig(
        uuid=user.lower() if is_uuid(user.lower()) else user,
        host=host.lower().rstrip("."),
        port=port,
        remark=remark,
        remark_country=extract_flag_code(remark),
        raw=cleaned,
        sources=[source] if source else [],
    )
    _apply_query(cfg, _parse_query(query))
    cfg.fingerprint = fingerprint(cfg)
    return cfg


def parse_many(text: str, source: str = "") -> list[VlessConfig]:
    configs: list[VlessConfig] = []
    for uri in extract_vless_uris(text):
        cfg = parse_vless(uri, source=source)
        if cfg is not None:
            configs.append(cfg)
    return configs


def dedup(configs: list[VlessConfig]) -> list[VlessConfig]:
    ordered: dict[str, VlessConfig] = {}
    for cfg in configs:
        current = ordered.get(cfg.fingerprint)
        if current is None:
            ordered[cfg.fingerprint] = cfg
            continue
        for name in cfg.sources:
            if name and name not in current.sources:
                current.sources.append(name)
        if cfg.remark_country and not current.remark_country:
            current.remark = cfg.remark
            current.remark_country = cfg.remark_country
        elif not current.remark and cfg.remark:
            current.remark = cfg.remark
    return list(ordered.values())


def build_uri(cfg: VlessConfig, remark: str | None = None) -> str:
    params: list[tuple[str, str]] = [("encryption", cfg.encryption or "none")]
    if cfg.flow:
        params.append(("flow", cfg.flow))
    params.append(("type", cfg.network or "tcp"))
    params.append(("security", cfg.security or "none"))
    if cfg.sni:
        params.append(("sni", cfg.sni))
    if cfg.fp:
        params.append(("fp", cfg.fp))
    if cfg.pbk:
        params.append(("pbk", cfg.pbk))
    if cfg.sid:
        params.append(("sid", cfg.sid))
    if cfg.spx:
        params.append(("spx", cfg.spx))
    if cfg.path:
        params.append(("path", cfg.path))
    if cfg.host_header:
        params.append(("host", cfg.host_header))
    if cfg.service_name:
        params.append(("serviceName", cfg.service_name))
    if cfg.mode:
        params.append(("mode", cfg.mode))
    if cfg.alpn:
        params.append(("alpn", cfg.alpn))
    if cfg.header_type:
        params.append(("headerType", cfg.header_type))
    if cfg.authority:
        params.append(("authority", cfg.authority))
    if cfg.extra:
        params.append(("extra", cfg.extra))
    if cfg.packet_encoding:
        params.append(("packetEncoding", cfg.packet_encoding))
    if cfg.allow_insecure:
        params.append(("allowInsecure", "1"))
    for key in sorted(cfg.extras):
        params.append((key, cfg.extras[key]))
    query = urlencode(params, quote_via=quote, safe="")
    host = f"[{cfg.host}]" if ":" in cfg.host else cfg.host
    title = cfg.remark if remark is None else remark
    fragment = quote(title, safe="")
    return f"vless://{cfg.uuid}@{host}:{cfg.port}?{query}#{fragment}"


def _clean_uri(uri: str) -> str:
    uri = uri.strip().strip("\"'`")
    uri = uri.rstrip(_TRAIL)
    while uri.endswith(")") and uri.count("(") < uri.count(")"):
        uri = uri[:-1]
    return uri


def _unquote_repeat(value: str, rounds: int = 2) -> str:
    current = value
    for _ in range(rounds):
        nxt = unquote(current)
        if nxt == current:
            break
        current = nxt
    return current


def _parse_query(query: str) -> dict[str, str]:
    """Parse a query without treating '+' as space (base64 public keys)."""
    out: dict[str, str] = {}
    if not query:
        return out
    for part in query.split("&"):
        if not part:
            continue
        key, _, value = part.partition("=")
        name = unquote(key).strip().lower()
        if not name:
            continue
        out[name] = unquote(value).strip()
    return out


def _split_host_port(hostport: str) -> tuple[str, int | None]:
    if not hostport:
        return "", None
    if hostport.startswith("["):
        end = hostport.find("]")
        if end < 0:
            return "", None
        host = hostport[1:end]
        rest = hostport[end + 1 :]
        if not rest.startswith(":"):
            return "", None
        port_str = rest[1:]
    else:
        if ":" not in hostport:
            return "", None
        host, port_str = hostport.rsplit(":", 1)
    host = unquote(host).strip()
    try:
        port = int(port_str)
    except ValueError:
        return "", None
    if port < 1 or port > 65535 or not host:
        return "", None
    return host, port


def _apply_query(cfg: VlessConfig, query: dict[str, str]) -> None:
    extras: dict[str, str] = {}
    for key, val in query.items():
        if key == "encryption":
            cfg.encryption = val or "none"
        elif key == "flow":
            cfg.flow = val
        elif key in {"type", "network"} and val:
            cfg.network = normalize_network(val)
        elif key == "security":
            cfg.security = normalize_security(val)
        elif key in {"sni", "servername", "peer"}:
            if val and (key == "sni" or not cfg.sni):
                cfg.sni = val
        elif key in {"fp", "fingerprint"}:
            cfg.fp = val
        elif key in {"pbk", "publickey"}:
            cfg.pbk = val
        elif key in {"sid", "shortid"}:
            cfg.sid = val
        elif key in {"spx", "spiderx"}:
            cfg.spx = val
        elif key == "path":
            cfg.path = val
        elif key == "host":
            cfg.host_header = val
        elif key in {"servicename", "service_name"}:
            cfg.service_name = val
        elif key == "authority":
            cfg.authority = val
        elif key == "mode":
            cfg.mode = val
        elif key == "alpn":
            cfg.alpn = val
        elif key in {"headertype", "header_type"}:
            cfg.header_type = val
        elif key in {"allowinsecure", "insecure", "allow_insecure"}:
            cfg.allow_insecure = val.lower() in {"1", "true", "yes", "on"}
        elif key == "extra":
            cfg.extra = val
        elif key in {"packetencoding", "packet_encoding"}:
            cfg.packet_encoding = val
        elif key in _IGNORE_KEYS:
            continue
        elif val:
            extras[key] = val
    cfg.extras = extras
    cfg.network = normalize_network(cfg.network or "tcp")
    cfg.security = normalize_security(cfg.security or "none")
    cfg.encryption = cfg.encryption or "none"


def _b64_decode_text(text: str) -> str | None:
    compact = "".join(text.split())
    if compact.lower().startswith("base64:"):
        compact = compact[7:]
    if len(compact) < 24 or not re.fullmatch(r"[A-Za-z0-9+/=_-]+", compact):
        return None
    compact = compact.replace("-", "+").replace("_", "/")
    pad = "=" * ((4 - len(compact) % 4) % 4)
    try:
        raw = base64.b64decode(compact + pad, validate=False)
    except Exception:
        return None
    if not raw:
        return None
    decoded = raw.decode("utf-8", errors="ignore")
    if "vless://" not in decoded.lower():
        return None
    return decoded
