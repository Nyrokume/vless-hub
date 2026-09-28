"""Parse vless://, ss://, trojan://, and hysteria2:// URIs and subscription blobs.

Fingerprints ignore the remark and the TLS fingerprint (``fp``). Field order,
joined by ``|``:

protocol, uuid, host, port, security, sni, pbk, sid, flow, network, path,
host_header, service_name, mode, encryption, alpn, header_type, packet_encoding,
allow_insecure (1/0), spx, authority, extra, extras (k=v&k=v, sorted).

uuid/host/sni/host_header/alpn/header_type/packet_encoding/security/network
are lowercased. The inspector in ``site/src/lib/vless.ts`` must stay in lockstep
for VLESS.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
from urllib.parse import quote, unquote, urlencode

from vlesshub.models import VlessConfig

VLESS_RE = re.compile(r"vless://[^\s<>\"'`]+", re.IGNORECASE)
PROXY_RE = re.compile(
    r"(?:vless|vmess|trojan|ssr|ss|tuic|hysteria2|hy2|hysteria|juicity|wireguard|naive)://[^\s<>\"'`]+",
    re.IGNORECASE,
)
_UNSUPPORTED_SCHEMES = {
    "vmess",
    "ssr",
    "tuic",
    "hysteria",
    "juicity",
    "wireguard",
    "naive",
}
_XHTTP_MODES = {"auto", "packet-up", "stream-one", "stream-up", "stream-down"}
_ALPN_OK = {"h3", "h2", "http/1.1", "http/1.0"}
_SS_METHODS = {
    "aes-128-gcm",
    "aes-256-gcm",
    "aes-128-cfb",
    "aes-256-cfb",
    "chacha20-ietf-poly1305",
    "chacha20-poly1305",
    "2022-blake3-aes-128-gcm",
    "2022-blake3-aes-256-gcm",
    "2022-blake3-chacha20-poly1305",
}
_FP_RANK = {
    "chrome": 0,
    "firefox": 1,
    "edge": 2,
    "safari": 3,
    "ios": 4,
    "android": 5,
    "random": 6,
    "qq": 7,
}
_KEEP_EXTRAS = {"obfs", "obfs-password", "mport"}
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
        cfg.protocol or "vless",
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
    return [uri for uri in extract_proxy_uris(text) if uri.lower().startswith("vless://")]


def _unescape_markup(text: str) -> str:
    """Decode HTML entities that include a semicolon.

    ``html.unescape`` also rewrites ``&note`` (no semicolon) into ``¬e``, which
    corrupts the next query field and splits one config into many fingerprints.
    """
    if not text:
        return ""

    def replace(match: re.Match[str]) -> str:
        return html.unescape(match.group(0))

    return re.sub(r"&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);", replace, text)


def canonical_extra(value: str) -> str:
    """One JSON spelling, so whitespace does not change the fingerprint."""
    text = (value or "").strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return text
    return json.dumps(parsed, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def extract_proxy_uris(text: str) -> list[str]:
    """Pull vless, shadowsocks, trojan, and hysteria2 URIs out of a subscription."""
    text = _unescape_markup(text or "")
    text = text.replace("\ufeff", "").replace("\\u0026", "&").replace("\\/", "/")
    found: list[str] = []
    seen: set[str] = set()

    def add_from(blob: str) -> None:
        for match in PROXY_RE.findall(blob):
            uri = _clean_uri(match)
            key = uri.lower()
            if "://" in key and uri not in seen:
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
    cleaned = _clean_uri(_unescape_markup(uri.strip()))
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
        raw=cleaned,
        sources=[source] if source else [],
    )
    _apply_query(cfg, _parse_query(query))
    _finish(cfg)
    return cfg


def parse_any(uri: str, source: str = "") -> VlessConfig | None:
    cleaned = _clean_uri(_unescape_markup(uri.strip()))
    scheme = cleaned.split(":", 1)[0].lower()
    if scheme == "vless":
        return parse_vless(cleaned, source=source)
    if scheme == "ss":
        return _parse_ss(cleaned, source)
    if scheme == "trojan":
        return _parse_trojan(cleaned, source)
    if scheme in {"hysteria2", "hy2"}:
        return _parse_hysteria2(cleaned, source)
    return None


def parse_many(text: str, source: str = "") -> list[VlessConfig]:
    configs, _reasons = parse_document(text, source=source, validate=False)
    return configs


def parse_document(
    text: str,
    source: str = "",
    *,
    validate: bool = True,
) -> tuple[list[VlessConfig], dict[str, int]]:
    """Return kept configs and rejection counts for this document."""
    reasons = {"parse_error": 0, "invalid_field": 0, "unsupported_protocol": 0}
    configs: list[VlessConfig] = []
    for uri in extract_proxy_uris(text):
        kind = _reject_kind(uri)
        if kind:
            reasons[kind] += 1
            continue
        cfg = parse_any(uri, source=source)
        if cfg is None:
            reasons["parse_error"] += 1
            continue
        if validate and invalid_reason(cfg):
            reasons["invalid_field"] += 1
            continue
        configs.append(cfg)
    return configs, reasons


def _reject_kind(uri: str) -> str | None:
    """unsupported_protocol for schemes we do not test; None when parse_any should try."""
    cleaned = _clean_uri(_unescape_markup(uri.strip()))
    scheme = cleaned.split(":", 1)[0].lower()
    if scheme in _UNSUPPORTED_SCHEMES or _is_wrapped_vmess(cleaned):
        return "unsupported_protocol"
    return None


def _is_wrapped_vmess(uri: str) -> bool:
    """Some lists put a VMess JSON share in an ss:// wrapper."""
    if not uri.lower().startswith("ss://"):
        return False
    body = uri[len("ss://") :]
    body = body.split("#", 1)[0].split("?", 1)[0]
    if "@" in body:
        return False
    payload = _decode_json_b64(unquote(body).strip())
    return isinstance(payload, dict) and "add" in payload and "id" in payload


def invalid_reason(cfg: VlessConfig) -> str | None:
    """Return invalid_field when a parsed config must not be tested or published."""
    if cfg.port < 1 or cfg.port > 65535 or not cfg.host:
        return "invalid_field"
    if cfg.protocol == "vless":
        if not is_uuid(cfg.uuid):
            return "invalid_field"
        if cfg.security == "reality":
            if len(cfg.pbk) < 16 or not _plausible_name(cfg.sni):
                return "invalid_field"
        return None
    if cfg.protocol == "shadowsocks":
        if cfg.encryption not in _SS_METHODS or not cfg.uuid:
            return "invalid_field"
        return None
    if cfg.protocol == "trojan":
        if len(cfg.uuid) < 4:
            return "invalid_field"
        return None
    if cfg.protocol == "hysteria2":
        if not cfg.uuid:
            return "invalid_field"
        return None
    return "invalid_field"


def access_key(cfg: VlessConfig) -> str:
    """Same server, port, and credentials are one config, whatever the path or title."""
    return "|".join(
        [
            (cfg.protocol or "vless").lower(),
            (cfg.host or "").lower(),
            str(int(cfg.port)),
            (cfg.uuid or "").strip().lower(),
        ]
    )


def dedup(configs: list[VlessConfig]) -> list[VlessConfig]:
    ordered: dict[str, VlessConfig] = {}
    for cfg in configs:
        key = access_key(cfg)
        current = ordered.get(key)
        if current is None:
            ordered[key] = cfg
            continue
        for name in cfg.sources:
            if name and name not in current.sources:
                current.sources.append(name)
        if _variant_rank(cfg) < _variant_rank(current):
            cfg.sources = list(current.sources)
            if not cfg.remark and current.remark:
                cfg.remark = current.remark
            ordered[key] = cfg
            continue
        if not current.remark and cfg.remark:
            current.remark = cfg.remark
        if _fp_rank(cfg.fp) < _fp_rank(current.fp):
            current.fp = cfg.fp
    return list(ordered.values())


_SECURITY_RANK = {"reality": 0, "tls": 1, "none": 3}


def _variant_rank(cfg: VlessConfig) -> tuple[int, int, int]:
    security = normalize_security(cfg.security)
    return (_SECURITY_RANK.get(security, 2), _fp_rank(cfg.fp), 0 if cfg.sni else 1)


def _fp_rank(value: str) -> int:
    key = (value or "").strip().lower()
    if not key:
        return 90
    return _FP_RANK.get(key, 50)


def build_uri(cfg: VlessConfig, remark: str | None = None) -> str:
    if cfg.protocol == "shadowsocks":
        return _build_ss_uri(cfg, remark)
    if cfg.protocol == "trojan":
        return _build_user_uri("trojan", cfg, remark)
    if cfg.protocol == "hysteria2":
        return _build_user_uri("hysteria2", cfg, remark)
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
    hostport = _strip_port_path(hostport.strip())
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


def _strip_port_path(hostport: str) -> str:
    """Drop `/` or `/path` glued to the port (`host:443/?type=ws`)."""
    if hostport.startswith("["):
        end = hostport.find("]")
        if end >= 0:
            slash = hostport.find("/", end)
            if slash >= 0:
                return hostport[:slash]
        return hostport
    slash = hostport.find("/")
    if slash >= 0:
        return hostport[:slash]
    return hostport


def _decode_json_b64(payload: str) -> dict | None:
    compact = "".join(payload.split())
    if compact.lower().startswith("base64:"):
        compact = compact[7:]
    if len(compact) < 16 or not re.fullmatch(r"[A-Za-z0-9+/=_-]+", compact):
        return None
    compact = compact.replace("-", "+").replace("_", "/")
    pad = "=" * ((4 - len(compact) % 4) % 4)
    try:
        raw = base64.b64decode(compact + pad, validate=False)
    except Exception:
        return None
    text = raw.decode("utf-8", errors="ignore").strip()
    if not text.startswith("{") or not text.endswith("}"):
        return None
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


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
            cfg.host_header = sanitize_host_header(val)
        elif key in {"servicename", "service_name"}:
            cfg.service_name = val
        elif key == "authority":
            cfg.authority = val
        elif key == "mode":
            cfg.mode = val
        elif key == "alpn":
            cfg.alpn = sanitize_alpn(val)
        elif key in {"headertype", "header_type"}:
            cfg.header_type = "" if val.lower() in {"", "none"} else val.lower()
        elif key in {"allowinsecure", "insecure", "allow_insecure"}:
            cfg.allow_insecure = val.lower() in {"1", "true", "yes", "on"}
        elif key == "extra":
            cfg.extra = val
        elif key in {"packetencoding", "packet_encoding"}:
            cfg.packet_encoding = val
        elif key in {"obfs-password", "obfspassword"} and val:
            extras["obfs-password"] = val
        elif key in _KEEP_EXTRAS and val:
            extras[key] = val
        elif key in _IGNORE_KEYS or key == "telegram":
            continue
    cfg.extras = extras
    cfg.network = normalize_network(cfg.network or "tcp")
    cfg.security = normalize_security(cfg.security or "none")
    cfg.encryption = cfg.encryption or "none"
    if cfg.network == "h2" and (cfg.mode.lower() in _XHTTP_MODES or cfg.extra):
        cfg.network = "xhttp"
    if cfg.fp:
        cfg.fp = cfg.fp.lower()


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
    if not PROXY_RE.search(decoded):
        return None
    return decoded


def _finish(cfg: VlessConfig) -> None:
    if cfg.network == "tcp" and cfg.path in {"", "/"}:
        cfg.path = ""
    if cfg.header_type.lower() in {"", "none"}:
        cfg.header_type = ""
    cfg.sni = cfg.sni.strip()
    cfg.extra = canonical_extra(cfg.extra)
    cfg.remark_country = extract_flag_code(cfg.remark)
    cfg.fingerprint = fingerprint(cfg)


def sanitize_alpn(value: str) -> str:
    kept: list[str] = []
    for part in (value or "").split(","):
        token = part.strip().lower()
        if token in _ALPN_OK and token not in kept:
            kept.append(token)
    return ",".join(kept)


def sanitize_host_header(value: str) -> str:
    kept: list[str] = []
    for part in (value or "").split(","):
        token = part.strip()
        if token and _plausible_name(token) and token not in kept:
            kept.append(token)
    return ",".join(kept)


def _plausible_name(value: str) -> bool:
    token = (value or "").strip().rstrip(".")
    if not token or "@" in token or token.startswith("-") or " " in token:
        return False
    if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", token):
        return True
    if "." not in token or len(token) > 253:
        return False
    labels = token.split(".")
    return all(re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) for label in labels)


def _parse_ss(uri: str, source: str) -> VlessConfig | None:
    body, remark = _split_remark(uri[len("ss://") :])
    if "?" in body:
        body = body.split("?", 1)[0]
    method = ""
    password = ""
    host = ""
    port: int | None = None
    if "@" in body:
        userinfo, hostport = body.rsplit("@", 1)
        userinfo = unquote(userinfo)
        plain = _plain_ss_userinfo(userinfo)
        if plain:
            method, password = plain
        else:
            decoded = _b64_userinfo(userinfo)
            if not decoded or ":" not in decoded:
                return None
            method, password = decoded.split(":", 1)
        host, port = _split_host_port(hostport)
    else:
        decoded = _b64_userinfo(unquote(body))
        if not decoded or "@" not in decoded or ":" not in decoded.split("@", 1)[0]:
            return None
        user, hostport = decoded.rsplit("@", 1)
        method, password = user.split(":", 1)
        host, port = _split_host_port(hostport)
    if not method or not password or not host or port is None:
        return None
    if host.lower() in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return None
    cfg = VlessConfig(
        protocol="shadowsocks",
        uuid=password,
        host=host.lower().rstrip("."),
        port=port,
        encryption=method.lower(),
        network="tcp",
        security="none",
        remark=remark,
        raw=uri,
        sources=[source] if source else [],
    )
    _finish(cfg)
    return cfg


def _parse_trojan(uri: str, source: str) -> VlessConfig | None:
    body, remark = _split_remark(uri[len("trojan://") :])
    query = ""
    if "?" in body:
        body, query = body.split("?", 1)
    if "@" not in body:
        return None
    password, hostport = body.rsplit("@", 1)
    password = unquote(password).strip()
    host, port = _split_host_port(hostport)
    if not password or not host or port is None:
        return None
    cfg = VlessConfig(
        protocol="trojan",
        uuid=password,
        host=host.lower().rstrip("."),
        port=port,
        network="tcp",
        security="tls",
        remark=remark,
        raw=uri,
        sources=[source] if source else [],
    )
    _apply_query(cfg, _parse_query(query))
    if not cfg.security or cfg.security == "none":
        cfg.security = "tls"
    _finish(cfg)
    return cfg


def _parse_hysteria2(uri: str, source: str) -> VlessConfig | None:
    rest = uri.split("://", 1)[1]
    body, remark = _split_remark(rest)
    query = ""
    if "?" in body:
        body, query = body.split("?", 1)
    if "@" not in body:
        return None
    password, hostport = body.rsplit("@", 1)
    password = unquote(password).strip()
    host, port = _split_host_port(hostport)
    if not password or not host or port is None:
        return None
    cfg = VlessConfig(
        protocol="hysteria2",
        uuid=password,
        host=host.lower().rstrip("."),
        port=port,
        network="hysteria2",
        security="tls",
        remark=remark,
        raw=uri,
        sources=[source] if source else [],
    )
    _apply_query(cfg, _parse_query(query))
    cfg.network = "hysteria2"
    cfg.security = "tls"
    _finish(cfg)
    return cfg


def _split_remark(body: str) -> tuple[str, str]:
    if "#" not in body:
        return body, ""
    body, fragment = body.split("#", 1)
    return body, _unquote_repeat(fragment).strip()


def _plain_ss_userinfo(userinfo: str) -> tuple[str, str] | None:
    if ":" not in userinfo:
        return None
    method, password = userinfo.split(":", 1)
    method = method.strip().lower()
    if method not in _SS_METHODS or not password:
        return None
    return method, password


def _b64_userinfo(value: str) -> str | None:
    compact = value.strip().replace("-", "+").replace("_", "/")
    if not compact or not re.fullmatch(r"[A-Za-z0-9+/=]+", compact):
        return None
    pad = "=" * ((4 - len(compact) % 4) % 4)
    try:
        raw = base64.b64decode(compact + pad, validate=False)
    except Exception:
        return None
    text = raw.decode("utf-8", errors="ignore")
    return text or None


def _build_ss_uri(cfg: VlessConfig, remark: str | None) -> str:
    raw = f"{cfg.encryption}:{cfg.uuid}".encode()
    user = base64.b64encode(raw).decode("ascii")
    title = cfg.remark if remark is None else remark
    return f"ss://{user}@{_host_token(cfg)}:{cfg.port}#{quote(title, safe='')}"


def _build_user_uri(scheme: str, cfg: VlessConfig, remark: str | None) -> str:
    params: list[tuple[str, str]] = []
    if cfg.protocol == "trojan":
        params.append(("security", cfg.security or "tls"))
        if cfg.sni:
            params.append(("sni", cfg.sni))
        if cfg.network and cfg.network != "tcp":
            params.append(("type", cfg.network))
        if cfg.fp:
            params.append(("fp", cfg.fp))
        if cfg.allow_insecure:
            params.append(("allowInsecure", "1"))
    else:
        if cfg.sni:
            params.append(("sni", cfg.sni))
        if cfg.allow_insecure:
            params.append(("insecure", "1"))
        if cfg.extras.get("obfs"):
            params.append(("obfs", cfg.extras["obfs"]))
        if cfg.extras.get("obfs-password"):
            params.append(("obfs-password", cfg.extras["obfs-password"]))
    query = urlencode(params, quote_via=quote, safe="")
    title = cfg.remark if remark is None else remark
    suffix = f"?{query}" if query else ""
    return f"{scheme}://{quote(cfg.uuid, safe='')}@{_host_token(cfg)}:{cfg.port}{suffix}#{quote(title, safe='')}"


def _host_token(cfg: VlessConfig) -> str:
    return f"[{cfg.host}]" if ":" in cfg.host else cfg.host
