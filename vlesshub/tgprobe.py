"""Confirm a Telegram proxy speaks the protocol, not only that a port is open.

MTProto (plain and dd secrets): obfuscated2 handshake, then req_pq_multi on the
padded-intermediate transport. Success is a resPQ that echoes our nonce.
ee secrets: a fake-TLS ClientHello (HMAC over the secret), a matching
ServerHello, then the same MTProto exchange inside TLS application records.

SOCKS5: greeting and CONNECT to Telegram DC 149.154.167.51:443, then the same
unauthenticated obfuscated2 probe through that tunnel.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import socket
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from vlesshub.tgparse import TgProxy, secret_key
from vlesshub.util import log

DC_HOST = "149.154.167.51"
DC_PORT = 443
DC_ID = 2
_REQ_PQ_MULTI = 0xBE7E8EF1
_RES_PQ = 0x05162463
_TAG_DD = b"\xdd\xdd\xdd\xdd"
_TAG_EE = b"\xee\xee\xee\xee"


@dataclass(slots=True)
class TgProbeResult:
    ok: bool
    latency_ms: float | None = None
    error: str = ""
    reason: str = ""


class MtprotoError(ConnectionError):
    """The proxy answered, but Telegram did not complete req_pq / resPQ."""


class SocksError(ConnectionError):
    """SOCKS5 did not finish the greeting or the tunnel to a Telegram DC."""


def classify_tg_error(error: str) -> str:
    """Map a Telegram probe failure to a reason the site can show in Russian."""
    err = (error or "").lower()
    if "timeout" in err or "timed out" in err:
        return "timeout"
    if "refused" in err or "network is unreachable" in err or "no route" in err:
        return "tcp_refused"
    if "socks" in err:
        return "socks_fail"
    if any(token in err for token in ("respq", "mtproto", "fake-tls", "frame", "server hello")):
        return "mtproto_fail"
    return "handshake_fail"


class AesCtr:
    """AES-256-CTR with the full 16-byte IV as the initial counter block."""

    def __init__(self, key: bytes, iv: bytes) -> None:
        self._key = key
        self._counter = int.from_bytes(iv, "big")
        self._spare = b""

    def xor(self, data: bytes) -> bytes:
        out = bytearray()
        for byte in data:
            if not self._spare:
                enc = Cipher(algorithms.AES(self._key), modes.ECB()).encryptor()
                block = self._counter.to_bytes(16, "big")
                self._spare = enc.update(block) + enc.finalize()
                self._counter = (self._counter + 1) & ((1 << 128) - 1)
            out.append(byte ^ self._spare[0])
            self._spare = self._spare[1:]
        return bytes(out)


def probe_many(
    proxies: list[TgProxy],
    timeout: float,
    concurrency: int,
) -> dict[str, TgProbeResult]:
    if not proxies:
        return {}
    workers = max(1, min(concurrency, len(proxies)))
    results: dict[str, TgProbeResult] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(probe_one, proxy, timeout): proxy for proxy in proxies}
        done = 0
        for future in as_completed(futures):
            proxy = futures[future]
            done += 1
            try:
                results[proxy.fingerprint] = future.result()
            except Exception as exc:  # noqa: BLE001
                error = f"{type(exc).__name__}: {exc}"
                results[proxy.fingerprint] = TgProbeResult(False, error=error[:180], reason=classify_tg_error(error))
            if done % 25 == 0 or done == len(proxies):
                ok = sum(1 for item in results.values() if item.ok)
                log(f"tg probe {done}/{len(proxies)} ok={ok}")
    return results


def probe_one(proxy: TgProxy, timeout: float) -> TgProbeResult:
    started = time.perf_counter()
    try:
        if proxy.kind == "socks":
            _socks_then_mtproto(proxy, timeout)
        elif proxy.mode == "ee":
            _fake_tls(proxy, timeout)
        else:
            _obfuscated_with_fallback(proxy, timeout)
    except (MtprotoError, SocksError) as exc:
        error = f"{type(exc).__name__}: {exc}"[:180]
        reason = "mtproto_fail" if isinstance(exc, MtprotoError) else "socks_fail"
        return TgProbeResult(False, error=error, reason=reason)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"[:180]
        return TgProbeResult(False, error=error, reason=classify_tg_error(error))
    elapsed = (time.perf_counter() - started) * 1000
    return TgProbeResult(True, latency_ms=round(elapsed, 1))


def _obfuscated_with_fallback(proxy: TgProxy, timeout: float) -> None:
    tags = [_TAG_DD]
    if proxy.mode == "plain":
        tags.append(_TAG_EE)
    last: Exception | None = None
    for tag in tags:
        try:
            _obfuscated(proxy.host, proxy.port, secret_key(proxy), tag, timeout, proxy=None)
            return
        except OSError as exc:
            last = exc
            if "connect" in str(exc).lower() or isinstance(exc, TimeoutError):
                raise
        except Exception as exc:  # noqa: BLE001
            last = exc
    if last:
        raise last


def _socks_then_mtproto(proxy: TgProxy, timeout: float) -> None:
    sock = _connect(proxy.host, proxy.port, timeout)
    try:
        _socks5(sock, DC_HOST, DC_PORT, proxy.user, proxy.password)
        _mtproto_exchange(sock, b"", _TAG_DD, timeout)
    finally:
        sock.close()


def _obfuscated(host: str, port: int, secret: bytes, tag: bytes, timeout: float, proxy: TgProxy | None) -> None:
    del proxy
    sock = _connect(host, port, timeout)
    try:
        _mtproto_exchange(sock, secret, tag, timeout)
    finally:
        sock.close()


def _mtproto_exchange(sock: socket.socket, secret: bytes, tag: bytes, timeout: float) -> None:
    try:
        payload, encryptor, decryptor = obfuscated_client_init(secret, DC_ID, tag)
        sock.sendall(payload)
        nonce = os.urandom(16)
        frame = frame_message(_req_pq(nonce), padded=tag == _TAG_DD)
        sock.sendall(encryptor.xor(frame))
        _read_respq(sock, decryptor, nonce, timeout)
    except MtprotoError:
        raise
    except (ConnectionError, TimeoutError, OSError) as exc:
        raise MtprotoError(str(exc) or "mtproto") from exc


def obfuscated_client_init(secret: bytes, dc_id: int, tag: bytes) -> tuple[bytes, AesCtr, AesCtr]:
    reserved = {0x44414548, 0x54534F50, 0x20544547, 0x4954504F, 0x02010316, 0xDDDDDDDD, 0xEEEEEEEE}
    while True:
        random = bytearray(os.urandom(64))
        if random[0] == 0xEF:
            continue
        if int.from_bytes(random[:4], "little") in reserved:
            continue
        if random[4:8] == b"\x00\x00\x00\x00":
            continue
        break
    random[56:60] = tag
    random[60:62] = int(dc_id).to_bytes(2, "little", signed=True)
    encrypt_key = hashlib.sha256(bytes(random[8:40]) + secret).digest()
    encrypt_iv = bytes(random[40:56])
    reversed_key = bytes(random[8:56])[::-1]
    decrypt_key = hashlib.sha256(reversed_key[:32] + secret).digest()
    decrypt_iv = reversed_key[32:48]
    encryptor = AesCtr(encrypt_key, encrypt_iv)
    decryptor = AesCtr(decrypt_key, decrypt_iv)
    encrypted = encryptor.xor(bytes(random))
    return bytes(random[:56]) + encrypted[56:], encryptor, decryptor


def frame_message(message: bytes, *, padded: bool) -> bytes:
    payload = message
    if padded:
        pad = (-len(message)) % 16
        if pad:
            payload += os.urandom(pad)
    return struct.pack("<I", len(payload)) + payload


def _req_pq(nonce: bytes) -> bytes:
    body = struct.pack("<I", _REQ_PQ_MULTI) + nonce
    msg_id = _message_id()
    return b"\x00" * 8 + struct.pack("<QI", msg_id, len(body)) + body


def _message_id() -> int:
    nano = time.time_ns()
    sec = nano // 1_000_000_000
    sub = ((nano % 1_000_000_000) << 32) // 1_000_000_000
    return ((sec << 32) | sub) & ~3


def _read_respq(sock: socket.socket, decryptor: AesCtr, nonce: bytes, timeout: float) -> None:
    sock.settimeout(timeout)
    length = struct.unpack("<I", decryptor.xor(_recvall(sock, 4)))[0]
    if length < 40 or length > 256:
        raise MtprotoError(f"unexpected frame {length}")
    blob = decryptor.xor(_recvall(sock, length))
    if len(blob) < 24:
        raise MtprotoError("short mtproto frame")
    msg_len = struct.unpack_from("<I", blob, 16)[0]
    if msg_len < 20 or 20 + msg_len > len(blob):
        raise MtprotoError("bad message length")
    tl = blob[20 : 20 + msg_len]
    ctor = struct.unpack_from("<I", tl, 0)[0]
    if ctor != _RES_PQ or tl[4:20] != nonce:
        raise MtprotoError(f"not resPQ ({ctor:#x})")


def _fake_tls(proxy: TgProxy, timeout: float) -> None:
    secret = secret_key(proxy)
    sni = proxy.domain or (_domain_sni(proxy.host) or "google.com")
    hello = build_client_hello(secret, sni)
    client_random = hello[11:43]
    sock = _connect(proxy.host, proxy.port, timeout)
    try:
        sock.sendall(hello)
        _records, blob = _read_tls_burst(sock, min(timeout, 4))
        if _find_server_hello(blob, secret, client_random) is None:
            raise MtprotoError("fake-tls server hello rejected")
        _mtproto_exchange_tls(sock, secret, timeout)
    finally:
        sock.close()


def _find_server_hello(blob: bytes, secret: bytes, client_random: bytes) -> bytes | None:
    # Current proxies MAC the whole reply: ServerHello + ChangeCipherSpec +
    # one fake ApplicationData record. The digest replaces the server random.
    if verify_server_hello(blob, secret, client_random):
        return blob
    offset = 0
    while offset + 5 <= len(blob):
        if blob[offset] != 0x16 or blob[offset + 1] != 0x03:
            offset += 1
            continue
        length = int.from_bytes(blob[offset + 3 : offset + 5], "big")
        end = offset + 5 + length
        if end > len(blob):
            return None
        record = blob[offset:end]
        if verify_server_hello(record, secret, client_random):
            return record
        offset = end
    return None


def verify_server_hello(record: bytes, secret: bytes, client_random: bytes) -> bool:
    if len(record) < 43 or record[0] != 0x16 or record[1] != 0x03 or record[5] != 0x02:
        return False
    server_random = record[11:43]
    zeros = record[:11] + (b"\x00" * 32) + record[43:]
    computed = hmac.new(secret, client_random + zeros, hashlib.sha256).digest()
    return hmac.compare_digest(computed, server_random)


def build_client_hello(secret: bytes, sni: str) -> bytes:
    """TLS 1.3-looking ClientHello.

    The shape follows a ClientHello that current fake-TLS proxies accept:
    the record payload is at least 512 bytes, and the 32-byte client random
    is HMAC-SHA256(secret, hello-with-zero-random) XOR (28 zero bytes || unix time).
    """
    session = os.urandom(32)
    ciphers = bytes.fromhex(
        "130313011302c02cc02bc024c023c00ac009cca9c030c02fc028c027c014c013"
        "cca8009d009c003d003c0035002fc008c012000a"
    )
    host = "".join(ch for ch in sni if ch.isascii() and (ch.isalnum() or ch in ".-")).strip(".") or "google.com"
    host_b = host.encode("ascii")
    sni_body = struct.pack(">H", len(host_b) + 3) + b"\x00" + struct.pack(">H", len(host_b)) + host_b
    extensions = [
        _ext(0xFF01, b"\x00"),
        _ext(0x0000, sni_body),
        _ext(0x0017, b""),
        _ext(0x000D, bytes.fromhex("001604030804040105030203080508050501080606010201")),
        _ext(0x0005, bytes.fromhex("0100000000")),
        _ext(0x0010, bytes.fromhex("002e0268320568322d31360568322d31350568322d313408737064792f332e3106737064792f3308687474702f312e31")),
        _ext(0x000B, bytes.fromhex("0100")),
        _ext(0x0033, bytes.fromhex("0024001d0020") + os.urandom(32)),
        _ext(0x002D, bytes.fromhex("0101")),
        _ext(0x002B, bytes.fromhex("080304030303020301")),
        _ext(0x000A, bytes.fromhex("0008001d001700180019")),
    ]
    blob = b"".join(extensions)
    record = _assemble_hello(session, ciphers, blob)
    payload_len = int.from_bytes(record[3:5], "big")
    # Padding extension is 4 bytes of header plus the zero body. Aim for a
    # record payload of at least 512, which fake-TLS servers require.
    pad = max(0, 512 - payload_len - 4)
    blob += _ext(0x0015, b"\x00" * pad)
    record = _assemble_hello(session, ciphers, blob)
    digest = hmac.new(secret, record, hashlib.sha256).digest()
    stamp = int(time.time()).to_bytes(4, "little")
    mixed = bytes(digest[i] ^ (b"\x00" * 28 + stamp)[i] for i in range(32))
    out = bytearray(record)
    out[11:43] = mixed
    return bytes(out)


def _assemble_hello(session: bytes, ciphers: bytes, extensions: bytes) -> bytes:
    hello = b"\x03\x03" + (b"\x00" * 32) + bytes([len(session)]) + session
    hello += struct.pack(">H", len(ciphers)) + ciphers + b"\x01\x00"
    hello += struct.pack(">H", len(extensions)) + extensions
    handshake = b"\x01" + struct.pack(">I", len(hello))[1:] + hello
    return b"\x16\x03\x01" + struct.pack(">H", len(handshake)) + handshake


def _ext(kind: int, data: bytes) -> bytes:
    return struct.pack(">HH", kind, len(data)) + data


def _mtproto_exchange_tls(sock: socket.socket, secret: bytes, timeout: float) -> None:
    payload, encryptor, decryptor = obfuscated_client_init(secret, DC_ID, _TAG_DD)
    nonce = os.urandom(16)
    frame = frame_message(_req_pq(nonce), padded=True)
    sock.sendall(_tls_app(payload))
    sock.sendall(_tls_app(encryptor.xor(frame)))
    stream = _TlsStream(sock, timeout)
    length = struct.unpack("<I", decryptor.xor(stream.read(4)))[0]
    if length < 40 or length > 256:
        raise MtprotoError(f"unexpected frame {length}")
    blob = decryptor.xor(stream.read(length))
    msg_len = struct.unpack_from("<I", blob, 16)[0]
    tl = blob[20 : 20 + msg_len]
    ctor = struct.unpack_from("<I", tl, 0)[0]
    if ctor != _RES_PQ or tl[4:20] != nonce:
        raise MtprotoError(f"not resPQ ({ctor:#x})")


def _tls_app(data: bytes) -> bytes:
    return b"\x17\x03\x03" + struct.pack(">H", len(data)) + data


class _TlsStream:
    def __init__(self, sock: socket.socket, timeout: float) -> None:
        self.sock = sock
        self.timeout = timeout
        self._buf = b""

    def read(self, n: int) -> bytes:
        while len(self._buf) < n:
            kind, payload = _read_record(self.sock, self.timeout)
            if kind == 0x17 and payload:
                self._buf += payload
            elif kind == 0x14:
                continue
            elif kind == 0:
                raise MtprotoError("tls stream closed")
        data, self._buf = self._buf[:n], self._buf[n:]
        return data


def _read_tls_burst(sock: socket.socket, timeout: float) -> tuple[list[tuple[int, bytes]], bytes]:
    global _burst_bytes
    sock.settimeout(timeout)
    blob = b""
    try:
        while len(blob) < 16384:
            chunk = sock.recv(4096)
            if not chunk:
                break
            blob += chunk
            if _records_complete(blob) and len(blob) > 80:
                sock.settimeout(0.25)
    except TimeoutError:
        pass
    return _parse_records(blob), blob


def _records_complete(blob: bytes) -> bool:
    offset = 0
    saw_hello = False
    while offset + 5 <= len(blob):
        length = int.from_bytes(blob[offset + 3 : offset + 5], "big")
        if offset + 5 + length > len(blob):
            return False
        if blob[offset] == 0x16:
            saw_hello = True
        offset += 5 + length
    return saw_hello and offset == len(blob)


def _parse_records(blob: bytes) -> list[tuple[int, bytes]]:
    records: list[tuple[int, bytes]] = []
    offset = 0
    while offset + 5 <= len(blob):
        kind = blob[offset]
        length = int.from_bytes(blob[offset + 3 : offset + 5], "big")
        end = offset + 5 + length
        if end > len(blob) or kind not in {0x14, 0x15, 0x16, 0x17}:
            break
        records.append((kind, blob[offset + 5 : end]))
        offset = end
    return records


def _read_record(sock: socket.socket, timeout: float) -> tuple[int, bytes]:
    sock.settimeout(timeout)
    try:
        header = _recvall(sock, 5)
    except TimeoutError as exc:
        raise MtprotoError("tls timeout") from exc
    kind = header[0]
    length = int.from_bytes(header[3:5], "big")
    if length > 20000:
        raise MtprotoError("tls record too large")
    return kind, _recvall(sock, length)


def _socks5(sock: socket.socket, host: str, port: int, user: str, password: str) -> None:
    try:
        _socks5_greeting(sock, host, port, user, password)
    except SocksError:
        raise
    except (ConnectionError, TimeoutError, OSError) as exc:
        raise SocksError(str(exc) or "socks") from exc


def _socks5_greeting(sock: socket.socket, host: str, port: int, user: str, password: str) -> None:
    if user or password:
        sock.sendall(b"\x05\x02\x00\x02")
    else:
        sock.sendall(b"\x05\x01\x00")
    method = _recvall(sock, 2)
    if method[0] != 5:
        raise SocksError("not socks5")
    if method[1] == 2:
        u = user.encode("utf-8")
        p = password.encode("utf-8")
        if len(u) > 255 or len(p) > 255:
            raise SocksError("socks auth too long")
        sock.sendall(bytes([1, len(u)]) + u + bytes([len(p)]) + p)
        auth = _recvall(sock, 2)
        if auth[1] != 0:
            raise SocksError("socks auth rejected")
    elif method[1] != 0:
        raise SocksError(f"socks method {method[1]}")
    ip = socket.inet_aton(host)
    sock.sendall(b"\x05\x01\x00\x01" + ip + struct.pack(">H", port))
    reply = _recvall(sock, 4)
    if reply[1] != 0:
        raise SocksError(f"socks connect {reply[1]}")
    if reply[3] == 1:
        _recvall(sock, 6)
    elif reply[3] == 4:
        _recvall(sock, 18)
    elif reply[3] == 3:
        ln = _recvall(sock, 1)[0]
        _recvall(sock, ln + 2)
    else:
        raise SocksError("socks bad atyp")


def _connect(host: str, port: int, timeout: float) -> socket.socket:
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as exc:
        raise OSError(f"connect: {exc}") from exc
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    sock.settimeout(timeout)
    return sock


def _recvall(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return buf


def _domain_sni(host: str) -> str:
    if host and not host.replace(".", "").isdigit() and ":" not in host:
        return host
    return ""
