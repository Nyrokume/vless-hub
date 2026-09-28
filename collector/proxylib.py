"""Parse and check public MTProto, SOCKS5 and HTTP proxies.

SOCKS5 and HTTP are checked with a real HTTP 204 through the proxy (`check: "real"`).
MTProto fake-TLS is a TLS handshake to the declared SNI. Classic MTProto sends an
obfuscated2 init and accepts the proxy only when it answers (`check: "real"`).
A proxy that merely accepts TCP is stored as `check: "tcp"` and must not be shown
as a real ping.
"""

from __future__ import annotations

import hashlib
import os
import re
import socket
import ssl
import subprocess
import time
from urllib.parse import parse_qs, unquote, urlparse

GENERATE_URLS = (
    "https://www.gstatic.com/generate_204",
    "https://cp.cloudflare.com/generate_204",
)
PROXY_RE = re.compile(
    r"(?:https?://t\.me/proxy|tg://proxy)\?[^\s<>\"']+",
    re.IGNORECASE,
)
HOST_PORT_RE = re.compile(r"^\[?([0-9A-Za-z.:_-]+)\]?:(\d{2,5})$")


def _identity(kind: str, host: str, port: int, secret: str) -> str:
    raw = f"{kind}|{host.lower()}|{port}|{secret.lower()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


def split_mtproto_secret(secret: str) -> tuple[str, bytes, str | None] | None:
    """Return (mode, 16-byte key, fake-tls domain). mode is simple|secured|faketls."""
    raw = unquote(secret).strip().lower()
    if not re.fullmatch(r"[0-9a-f]+", raw):
        return None
    mode = "simple"
    body = raw
    if raw.startswith("ee") and len(raw) >= 34:
        mode = "faketls"
        body = raw[2:]
    elif raw.startswith("dd") and len(raw) >= 34:
        mode = "secured"
        body = raw[2:]
    if len(body) < 32:
        return None
    try:
        key = bytes.fromhex(body[:32])
    except ValueError:
        return None
    domain = None
    if mode == "faketls" and len(body) > 32:
        try:
            domain = bytes.fromhex(body[32:]).decode("utf-8", errors="strict")
        except ValueError:
            domain = None
        if not domain:
            return None
    return mode, key, domain


def parse_mtproto(payload: str, source_id: str) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()
    for match in PROXY_RE.findall(payload):
        parsed = urlparse(match if "://" in match else f"tg://{match}")
        query = parse_qs(parsed.query)
        host = (query.get("server") or [""])[0].strip().strip(".")
        secret = (query.get("secret") or [""])[0].strip()
        try:
            port = int((query.get("port") or ["0"])[0])
        except ValueError:
            continue
        if not host or port < 1 or port > 65535 or split_mtproto_secret(secret) is None:
            continue
        item_id = _identity("mtproto", host, port, secret)
        if item_id in seen:
            continue
        seen.add(item_id)
        uri = f"tg://proxy?server={host}&port={port}&secret={secret}"
        found.append(
            {
                "id": item_id,
                "kind": "mtproto",
                "uri": uri,
                "host": host,
                "port": port,
                "secret": secret,
                "country_code": None,
                "country": None,
                "source": source_id,
            }
        )
    return found


def parse_host_ports(payload: str, kind: str, source_id: str) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()
    scheme = "socks5" if kind == "socks5" else "http"
    for line in payload.splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        if "://" in text:
            parsed = urlparse(text)
            host = (parsed.hostname or "").strip(".")
            port = parsed.port or 0
        else:
            matched = HOST_PORT_RE.match(text)
            if not matched:
                continue
            host, port_text = matched.group(1), matched.group(2)
            port = int(port_text)
        if not host or port < 1 or port > 65535:
            continue
        if host.lower() in {"localhost", "127.0.0.1", "0.0.0.0"}:
            continue
        item_id = _identity(kind, host, port, "")
        if item_id in seen:
            continue
        seen.add(item_id)
        found.append(
            {
                "id": item_id,
                "kind": kind,
                "uri": f"{scheme}://{host}:{port}",
                "host": host,
                "port": port,
                "secret": "",
                "country_code": None,
                "country": None,
                "source": source_id,
            }
        )
    return found


def parse_proxy_payload(kind: str, payload: str, source_id: str) -> list[dict]:
    if kind == "mtproto":
        return parse_mtproto(payload, source_id)
    if kind in {"socks5", "http"}:
        return parse_host_ports(payload, kind, source_id)
    return []


def _aes_ctr(key: bytes, iv: bytes, data: bytes) -> bytes | None:
    try:
        completed = subprocess.run(
            [
                "openssl",
                "enc",
                "-aes-256-ctr",
                "-K",
                key.hex(),
                "-iv",
                iv.hex(),
                "-nosalt",
            ],
            input=data,
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return None
    if completed.returncode != 0 or not completed.stdout:
        return None
    return completed.stdout


def obfuscated_init(secret: bytes, secure: bool = False) -> bytes | None:
    """64-byte MTProto obfuscated2 client init.

    The proxy reads the prekey from the clear prefix and checks the proto tag
    after AES-256-CTR, whose keystream starts at byte 0. Only the tail is
    encrypted, at keystream offset 56. `dd` secrets use the secure proto tag.
    """
    reserved_first = {b"\xef"}
    reserved_begin = {
        b"HEAD",
        b"POST",
        b"GET ",
        b"\xee\xee\xee\xee",
        b"\xdd\xdd\xdd\xdd",
        b"\x16\x03\x01\x02",
    }
    for _ in range(8):
        rnd = bytearray(os.urandom(64))
        if bytes(rnd[:1]) in reserved_first or bytes(rnd[:4]) in reserved_begin or bytes(rnd[4:8]) == b"\x00\x00\x00\x00":
            continue
        break
    else:
        return None
    rnd[56:60] = b"\xdd\xdd\xdd\xdd" if secure else b"\xef\xef\xef\xef"
    rnd[60:62] = (2).to_bytes(2, "little")
    key = hashlib_sha256(bytes(rnd[8:40]) + secret)
    keystream = _aes_ctr(key, bytes(rnd[40:56]), b"\x00" * 64)
    if keystream is None or len(keystream) < 64:
        return None
    rnd[56:64] = bytes(left ^ right for left, right in zip(rnd[56:64], keystream[56:64]))
    return bytes(rnd)


def hashlib_sha256(data: bytes) -> bytes:
    import hashlib

    return hashlib.sha256(data).digest()


def _tcp_ms(host: str, port: int, timeout: float) -> int | None:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return max(1, int((time.perf_counter() - started) * 1000))
    except Exception:
        return None


def _faketls_ms(host: str, port: int, server_name: str, timeout: float) -> int | None:
    started = time.perf_counter()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(timeout)
            with context.wrap_socket(sock, server_hostname=server_name) as tls:
                tls.do_handshake()
        return max(1, int((time.perf_counter() - started) * 1000))
    except Exception:
        return None


def _obfuscated_ms(host: str, port: int, secret: bytes, timeout: float, secure: bool) -> int | None:
    payload = obfuscated_init(secret, secure=secure)
    if payload is None:
        return None
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            sock.settimeout(min(timeout, 3))
            sock.sendall(payload)
            try:
                data = sock.recv(64)
            except socket.timeout:
                # No reply. A wrong secret often does this too, so it is not a real ping.
                return None
        if not data:
            return None
        return max(1, int((time.perf_counter() - started) * 1000))
    except Exception:
        return None


def _http_via_proxy(kind: str, host: str, port: int, timeout: float) -> int | None:
    flag = "--socks5-hostname" if kind == "socks5" else "--proxy"
    target = f"{host}:{port}" if kind == "socks5" else f"http://{host}:{port}"
    for url in GENERATE_URLS:
        try:
            completed = subprocess.run(
                [
                    "curl",
                    "-4",
                    "-sS",
                    "-o",
                    "/dev/null",
                    "-w",
                    "%{http_code} %{time_total}",
                    flag,
                    target,
                    "--max-time",
                    str(timeout),
                    "--connect-timeout",
                    str(timeout),
                    url,
                ],
                capture_output=True,
                text=True,
                timeout=timeout + 2,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            continue
        parts = (completed.stdout or "").split()
        if len(parts) != 2:
            continue
        try:
            code = int(parts[0])
            elapsed = max(1, int(float(parts[1]) * 1000))
        except ValueError:
            continue
        if code == 204:
            return elapsed
    return None


def check_proxy(proxy: dict, timeout: float, attempts: int = 2) -> dict | None:
    """Return a copy with delay_ms, check and successes, or None if the host is dead."""
    host = proxy["host"]
    port = int(proxy["port"])
    kind = proxy["kind"]
    samples: list[int] = []
    check = "real"
    for _ in range(attempts):
        if kind in {"socks5", "http"}:
            sample = _http_via_proxy(kind, host, port, timeout)
        else:
            parsed = split_mtproto_secret(proxy.get("secret") or "")
            if parsed is None:
                return None
            mode, key, domain = parsed
            if mode == "faketls" and domain:
                sample = _faketls_ms(host, port, domain, timeout)
            else:
                sample = _obfuscated_ms(host, port, key, timeout, secure=(mode == "secured"))
        if sample is not None:
            samples.append(sample)
    if samples:
        ordered = sorted(samples)
        mid = len(ordered) // 2
        delay = ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) // 2
        successes = len(samples)
    else:
        tcp = _tcp_ms(host, port, min(timeout, 3))
        if tcp is None:
            return None
        # Honest fallback: the port accepted TCP, the protocol check did not.
        delay = tcp
        successes = 1
        check = "tcp"
    record = dict(proxy)
    record["delay_ms"] = delay
    record["check"] = check
    record["successes"] = successes
    return record
