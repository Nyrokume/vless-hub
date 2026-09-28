"""Parse public Telegram proxy links into one canonical form.

Accepted inputs:
  tg://proxy?server=&port=&secret=
  https://t.me/proxy?... and https://telegram.me/proxy?...
  tg://socks?server=&port=&user=&pass=
  https://t.me/socks?...
  socks5://[user:pass@]host:port

Secrets may be 32 hex chars, a dd/ee prefix plus 16 bytes, or base64.
An ee secret is fake-TLS. A dd secret is padded-intermediate (obfuscated2).
Extra bytes after an ee secret are the fake-TLS domain.
"""

from __future__ import annotations

import base64
import hashlib
import re
from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urlsplit

_LINK = re.compile(
    r"(?:tg://(?:proxy|socks)\?[^\s\"'<>]+"
    r"|https?://(?:t\.me|telegram\.me)/(?:proxy|socks)\?[^\s\"'<>]+"
    r"|socks5://[^\s\"'<>]+)",
    re.IGNORECASE,
)
_HOST = re.compile(r"^[A-Za-z0-9._:-]{1,253}$")


@dataclass(slots=True)
class TgProxy:
    kind: str
    host: str
    port: int
    secret: str = ""
    mode: str = ""
    domain: str = ""
    user: str = ""
    password: str = ""
    remark: str = ""
    sources: list[str] = field(default_factory=list)
    fingerprint: str = ""
    country: str = ""
    country_name: str = ""
    ip: str = ""
    latency_ms: float | None = None
    status: str = ""
    stability: float | None = None
    uptime: float = 0.0
    checks_ok: int = 0
    checks_fail: int = 0
    bits: str = ""
    verified: str = ""

    def __post_init__(self) -> None:
        if not self.fingerprint:
            self.fingerprint = fingerprint(self)


def fingerprint(proxy: TgProxy) -> str:
    if proxy.kind == "socks":
        material = f"socks|{proxy.host}|{proxy.port}|{proxy.user}|{proxy.password}"
    else:
        material = f"mtproto|{proxy.host}|{proxy.port}|{proxy.secret}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def parse_many(text: str, source: str = "") -> list[TgProxy]:
    found: list[TgProxy] = []
    seen: set[str] = set()
    for match in _LINK.finditer(text or ""):
        raw = _unescape(match.group(0))
        proxy = parse_link(raw)
        if proxy is None:
            continue
        if proxy.fingerprint in seen:
            continue
        seen.add(proxy.fingerprint)
        if source:
            proxy.sources.append(source)
        found.append(proxy)
    return found


def dedup(proxies: list[TgProxy]) -> list[TgProxy]:
    merged: dict[str, TgProxy] = {}
    for proxy in proxies:
        current = merged.get(proxy.fingerprint)
        if current is None:
            merged[proxy.fingerprint] = proxy
            continue
        for name in proxy.sources:
            if name not in current.sources:
                current.sources.append(name)
        if not current.remark and proxy.remark:
            current.remark = proxy.remark
    return list(merged.values())


def parse_link(value: str) -> TgProxy | None:
    text = _unescape(value).strip()
    if not text:
        return None
    if text.lower().startswith("socks5://"):
        return _parse_socks5(text)
    if "://" not in text:
        return None
    parts = urlsplit(text)
    scheme = (parts.scheme or "").lower()
    kind = ""
    if scheme == "tg":
        name = (parts.netloc or parts.path or "").lower()
        if name.startswith("socks"):
            kind = "socks"
        elif name.startswith("proxy"):
            kind = "mtproto"
    elif scheme in {"http", "https"} and (parts.netloc or "").lower() in {"t.me", "telegram.me"}:
        path = (parts.path or "").strip("/").lower()
        if path == "socks":
            kind = "socks"
        elif path == "proxy":
            kind = "mtproto"
    if not kind:
        return None
    query = _query(parts.query)
    server = _host(query.get("server", ""))
    port = _port(query.get("port", ""))
    if not server or port is None:
        return None
    remark = unquote(parts.fragment or "").strip()
    if kind == "socks":
        user = query.get("user") or query.get("username") or ""
        password = query.get("pass") or query.get("password") or ""
        return TgProxy(kind="socks", host=server, port=port, user=user, password=password, remark=remark)
    decoded = decode_secret(query.get("secret", ""))
    if decoded is None:
        return None
    mode, key, domain = decoded
    return TgProxy(
        kind="mtproto",
        host=server,
        port=port,
        secret=canonical_secret(mode, key, domain),
        mode=mode,
        domain=domain,
        remark=remark,
    )


def decode_secret(raw: str) -> tuple[str, bytes, str] | None:
    text = unquote((raw or "").strip())
    if not text or any(ch.isspace() for ch in text):
        return None
    # A 32-char hex string is always a plain 16-byte secret, even if it
    # begins with ee or dd. Prefixes need the extra key bytes after them.
    if re.fullmatch(r"[0-9a-fA-F]{32}", text):
        return "plain", bytes.fromhex(text), ""
    prefix = ""
    body = text
    lower = text.lower()
    if lower.startswith(("ee", "dd")):
        prefix = lower[:2]
        body = text[2:]
    blob = _as_bytes(body)
    if blob is None or len(blob) < 16:
        if prefix:
            blob = _as_bytes(text)
            prefix = ""
        if blob is None or len(blob) < 16:
            return None
    key = blob[:16]
    domain = ""
    if prefix == "ee" and len(blob) > 16:
        tail = blob[16:].split(b"\x00", 1)[0]
        try:
            domain = tail.decode("ascii")
        except UnicodeDecodeError:
            domain = ""
        if domain and not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", domain):
            domain = ""
    mode = prefix or "plain"
    return mode, key, domain.strip(".")


def canonical_secret(mode: str, key: bytes, domain: str) -> str:
    hx = key.hex()
    if mode == "ee":
        extra = domain.encode("ascii").hex() if domain else ""
        return "ee" + hx + extra
    if mode == "dd":
        return "dd" + hx
    return hx


def secret_key(proxy: TgProxy) -> bytes:
    decoded = decode_secret(proxy.secret)
    if decoded is None:
        return b""
    return decoded[1]


def tg_link(proxy: TgProxy) -> str:
    if proxy.kind == "socks":
        query = f"server={quote(proxy.host, safe='')}&port={proxy.port}"
        if proxy.user:
            query += f"&user={quote(proxy.user, safe='')}"
        if proxy.password:
            query += f"&pass={quote(proxy.password, safe='')}"
        return f"tg://socks?{query}"
    return f"tg://proxy?server={quote(proxy.host, safe='')}&port={proxy.port}&secret={proxy.secret}"


def https_link(proxy: TgProxy) -> str:
    if proxy.kind == "socks":
        query = f"server={quote(proxy.host, safe='')}&port={proxy.port}"
        if proxy.user:
            query += f"&user={quote(proxy.user, safe='')}"
        if proxy.password:
            query += f"&pass={quote(proxy.password, safe='')}"
        return f"https://t.me/socks?{query}"
    return f"https://t.me/proxy?server={quote(proxy.host, safe='')}&port={proxy.port}&secret={proxy.secret}"


def _parse_socks5(text: str) -> TgProxy | None:
    rest = text[len("socks5://") :]
    user = password = ""
    if "@" in rest:
        auth, rest = rest.rsplit("@", 1)
        if ":" in auth:
            user, password = auth.split(":", 1)
        else:
            user = auth
        user = unquote(user)
        password = unquote(password)
    host, port = _split_hostport(rest)
    host = _host(host)
    port_n = _port(port)
    if not host or port_n is None:
        return None
    return TgProxy(kind="socks", host=host, port=port_n, user=user, password=password)


def _split_hostport(value: str) -> tuple[str, str]:
    text = value.strip().rstrip("/")
    if text.startswith("["):
        end = text.find("]")
        if end == -1:
            return "", ""
        host = text[1:end]
        tail = text[end + 1 :]
        if tail.startswith(":"):
            return host, tail[1:]
        return "", ""
    if text.count(":") == 1:
        host, port = text.split(":", 1)
        return host, port
    return "", ""


def _query(query: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in (query or "").split("&"):
        part = part.strip()
        if part.lower().startswith("amp;"):
            part = part[4:]
        if not part or "=" not in part:
            continue
        key, value = part.split("=", 1)
        out[unquote(key).strip().lower()] = unquote(value).strip()
    return out


def _host(value: str) -> str:
    host = unquote(value).strip().strip("[]").strip(".").lower()
    if not host or not _HOST.fullmatch(host):
        return ""
    return host


def _port(value: str) -> int | None:
    try:
        port = int(str(value).strip())
    except ValueError:
        return None
    if 1 <= port <= 65535:
        return port
    return None


def _as_bytes(value: str) -> bytes | None:
    if re.fullmatch(r"[0-9a-fA-F]{32,}", value) and len(value) % 2 == 0:
        try:
            return bytes.fromhex(value)
        except ValueError:
            return None
    pad = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + pad)
    except Exception:
        return None


def _unescape(value: str) -> str:
    return (
        value.replace("&amp;", "&")
        .replace("&#38;", "&")
        .replace("&quot;", '"')
        .replace("&#47;", "/")
    )
