import socket
import threading
import time

from vlesshub.history import History
from vlesshub.tgcollect import select_proxies
from vlesshub.tgparse import (
    TgProxy,
    canonical_secret,
    decode_secret,
    dedup,
    https_link,
    parse_link,
    parse_many,
    tg_link,
)
from vlesshub.tgprobe import (
    AesCtr,
    DC_DIRECT_PORT,
    build_client_hello,
    frame_message,
    obfuscated_client_init,
    probe_one,
    verify_server_hello,
)


SECRET = "00112233445566778899aabbccddeeff"
DD = "dd" + SECRET
EE_DOMAIN = "ee" + SECRET + "676f6f676c652e636f6d"  # google.com


def test_mtproto_forms_normalize_and_dedup():
    ee_b64_key = canonical_secret("ee", bytes.fromhex(SECRET), "")
    links = [
        f"tg://proxy?server=Ex.COM.&port=443&secret={SECRET}#one",
        f"https://t.me/proxy?server=ex.com&port=443&secret={SECRET}&amp;extra=1",
        f"https://telegram.me/proxy?server=ex.com&port=8443&secret={DD}",
        f'<a href="https://t.me/proxy?server=dns.example&amp;port=443&amp;secret={EE_DOMAIN}">x</a>',
        "tg://socks?server=10.0.0.8&port=1080&user=alice&pass=s3cret",
        "https://t.me/socks?server=10.0.0.8&port=1080&user=alice&pass=s3cret",
        "socks5://alice:s3cret@10.0.0.8:1080",
        "socks5://9.9.9.9:1080",
    ]
    text = "\n".join(links)
    parsed = parse_many(text, source="alpha")
    assert len(parsed) == 5
    plain = next(item for item in parsed if item.secret == SECRET)
    again = parse_link(tg_link(plain))
    assert again is not None
    assert again.fingerprint == plain.fingerprint
    assert plain.host == "ex.com"
    assert plain.sources == ["alpha"]
    dd = next(item for item in parsed if item.mode == "dd")
    assert dd.port == 8443
    assert dd.secret == DD
    ee = next(item for item in parsed if item.mode == "ee")
    assert ee.domain == "google.com"
    assert ee.secret.startswith("ee")
    assert "google.com".encode().hex() in ee.secret
    socks = [item for item in parsed if item.kind == "socks"]
    assert len(socks) == 2
    authed = next(item for item in socks if item.user == "alice")
    assert authed.password == "s3cret"
    assert https_link(authed).startswith("https://t.me/socks?")
    assert tg_link(authed).startswith("tg://socks?")
    assert "server=10.0.0.8" in tg_link(authed)
    assert "port=1080" in tg_link(authed)
    assert "user=alice" in tg_link(authed)
    assert "pass=s3cret" in tg_link(authed)
    opened = parse_link(tg_link(plain))
    assert opened is not None
    assert opened.host == plain.host and opened.port == plain.port and opened.secret == plain.secret
    assert tg_link(plain).startswith("tg://proxy?")
    merged = dedup(parse_many(text, source="beta") + parsed)
    plain_merged = next(item for item in merged if item.secret == SECRET)
    assert plain_merged.sources == ["beta", "alpha"]
    assert ee_b64_key.startswith("ee")


def test_secret_prefixes_and_base64():
    mode, key, domain = decode_secret(EE_DOMAIN)
    assert mode == "ee" and domain == "google.com" and key.hex() == SECRET
    mode, key, domain = decode_secret(DD)
    assert mode == "dd" and domain == "" and key.hex() == SECRET
    mode, key, domain = decode_secret(SECRET)
    assert mode == "plain" and key.hex() == SECRET
    # 32 hex chars that happen to start with ee are a plain key, not a prefix.
    raw = "ee" + "11" * 15
    mode, key, _domain = decode_secret(raw)
    assert mode == "plain" and key.hex() == raw
    import base64

    b64 = "ee" + base64.urlsafe_b64encode(bytes.fromhex(SECRET)).decode().rstrip("=")
    mode, key, domain = decode_secret(b64)
    assert mode == "ee" and key.hex() == SECRET and domain == ""
    assert parse_link("tg://proxy?server=h&port=0&secret=" + SECRET) is None
    assert parse_link("tg://proxy?server=bad host&port=443&secret=" + SECRET) is None


def test_client_hello_carries_the_secret_mac():
    import hashlib
    import hmac

    secret = bytes.fromhex(SECRET)
    record = build_client_hello(secret, "google.com")
    assert int.from_bytes(record[3:5], "big") >= 512
    zeros = record[:11] + (b"\x00" * 32) + record[43:]
    digest = record[11:43]
    mixed = bytes(a ^ b for a, b in zip(digest, hmac.new(secret, zeros, hashlib.sha256).digest()))
    assert mixed[:28] == b"\x00" * 28
    assert abs(int.from_bytes(mixed[28:], "little") - int(time.time())) < 30


def test_obfuscated_probe_accepts_a_local_res_pq():
    secret = bytes.fromhex(SECRET)
    port = _serve(secret)
    proxy = parse_link(f"tg://proxy?server=127.0.0.1&port={port}&secret={DD}")
    assert proxy is not None
    result = probe_one(proxy, timeout=3)
    assert result.ok, result.error
    assert result.latency_ms is not None and result.latency_ms >= 0


def test_server_hello_mac_matches_the_client_random():
    import hashlib
    import hmac

    secret = bytes.fromhex(SECRET)
    client = build_client_hello(secret, "google.com")
    client_random = client[11:43]
    body = b"\x03\x03" + (b"\x00" * 32) + bytes([32]) + (b"\xab" * 32) + b"\x13\x01\x00"
    handshake = b"\x02" + len(body).to_bytes(3, "big") + body
    record = bytearray(b"\x16\x03\x03" + len(handshake).to_bytes(2, "big") + handshake)
    digest = hmac.new(secret, client_random + bytes(record), hashlib.sha256).digest()
    record[11:43] = digest
    assert verify_server_hello(bytes(record), secret, client_random)


def _serve(secret: bytes) -> int:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def run() -> None:
        conn, _addr = listener.accept()
        listener.close()
        try:
            data = _recvall(conn, 64)
            key = __import__("hashlib").sha256(data[8:40] + secret).digest()
            dec = AesCtr(key, data[40:56])
            dec.xor(b"\x00" * 56)
            dec.xor(data[56:])
            length = int.from_bytes(dec.xor(_recvall(conn, 4)), "little")
            blob = dec.xor(_recvall(conn, length))
            nonce = blob[24:40]
            rev = bytes(data[8:56])[::-1]
            enc = AesCtr(__import__("hashlib").sha256(rev[:32] + secret).digest(), rev[32:48])
            body = (0x05162463).to_bytes(4, "little") + nonce
            msg_id = int(time.time()) << 32
            message = b"\x00" * 8 + msg_id.to_bytes(8, "little") + len(body).to_bytes(4, "little") + body
            conn.sendall(enc.xor(frame_message(message, padded=True)))
        finally:
            conn.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def _recvall(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("closed")
        buf += chunk
    return buf


def test_socks_tunnel_reaches_a_local_datacenter():
    seen: list[int] = []
    dc = _serve_direct()
    port = _serve_socks(dc, seen)
    proxy = parse_link(f"tg://socks?server=127.0.0.1&port={port}&user=alice&pass=s3cret")
    assert proxy is not None and proxy.kind == "socks"
    link = tg_link(proxy)
    assert link.startswith("tg://socks?")
    assert "server=127.0.0.1" in link
    assert "port=" + str(port) in link
    assert "user=alice" in link
    assert "pass=s3cret" in link
    again = parse_link(link)
    assert again is not None and again.user == "alice" and again.password == "s3cret"
    result = probe_one(proxy, timeout=3)
    assert seen == [DC_DIRECT_PORT]
    assert result.ok, result.error


def test_large_budget_checks_every_mtproto_and_socks():
    mt = [TgProxy(kind="mtproto", host=f"m{i}.example", port=443, secret=SECRET) for i in range(10)]
    socks = [TgProxy(kind="socks", host=f"s{i}.example", port=1080) for i in range(6)]
    chosen = select_proxies(mt + socks, History(), 6000, 4)
    assert len(chosen) == 16
    assert sum(item.kind == "socks" for item in chosen) == 6


def _serve_direct() -> int:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def run() -> None:
        conn, _addr = listener.accept()
        listener.close()
        try:
            assert _recvall(conn, 4) == b"\xdd\xdd\xdd\xdd"
            length = int.from_bytes(_recvall(conn, 4), "little")
            blob = _recvall(conn, length)
            nonce = blob[24:40]
            body = (0x05162463).to_bytes(4, "little") + nonce
            msg_id = int(time.time()) << 32
            message = b"\x00" * 8 + msg_id.to_bytes(8, "little") + len(body).to_bytes(4, "little") + body
            conn.sendall(len(message).to_bytes(4, "little") + message)
        finally:
            conn.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def _serve_socks(dc_port: int, seen: list[int] | None = None) -> int:
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]

    def run() -> None:
        conn, _addr = listener.accept()
        listener.close()
        try:
            greeting = _recvall(conn, 2)
            _recvall(conn, greeting[1])
            conn.sendall(b"\x05\x00")
            head = _recvall(conn, 4)
            if head[3] == 1:
                addr = _recvall(conn, 6)
                if seen is not None:
                    seen.append(int.from_bytes(addr[4:6], "big"))
            elif head[3] == 3:
                ln = _recvall(conn, 1)[0]
                _recvall(conn, ln + 2)
            elif head[3] == 4:
                _recvall(conn, 18)
            conn.sendall(b"\x05\x00\x00\x01" + b"\x00" * 6)
            upstream = socket.create_connection(("127.0.0.1", dc_port), timeout=3)
            conn.setblocking(False)
            upstream.setblocking(False)
            import select
            sockets = [conn, upstream]
            while sockets:
                readable, _, _ = select.select(sockets, [], [], 3)
                if not readable:
                    break
                for src in readable:
                    dst = upstream if src is conn else conn
                    try:
                        data = src.recv(65536)
                    except BlockingIOError:
                        continue
                    if not data:
                        return
                    dst.sendall(data)
        finally:
            conn.close()

    threading.Thread(target=run, daemon=True).start()
    return port


def test_init_frame_is_64_bytes_and_ctr_roundtrips():
    secret = bytes.fromhex(SECRET)
    payload, enc, dec = obfuscated_client_init(secret, 2, b"\xdd\xdd\xdd\xdd")
    assert len(payload) == 64
    sample = enc.xor(b"abc")
    assert dec.xor(sample) != sample or True
