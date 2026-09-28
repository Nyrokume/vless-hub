from __future__ import annotations

import json
import math
import os
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from vlesshub.models import VlessConfig
from vlesshub.util import log

_GENERATE_204 = "https://www.gstatic.com/generate_204"
_SPEED = "https://speed.cloudflare.com/__down?bytes=65536"
_ports_lock = threading.Lock()
_ports: set[int] = set()


@dataclass(slots=True)
class ProbeResult:
    ok: bool
    latency_ms: float | None = None
    speed_kbps: float | None = None
    error: str = ""


def tcp_probe(configs: list[VlessConfig], timeout: float, concurrency: int) -> dict[str, ProbeResult]:
    results: dict[str, ProbeResult] = {}
    if not configs:
        return results
    workers = max(1, min(concurrency, len(configs)))
    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    done = 0
    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_tcp_one, cfg.host, cfg.port, timeout): cfg for cfg in configs}
            try:
                for future in as_completed(futures, timeout=timeout * (len(configs) / workers) + 45):
                    cfg = futures[future]
                    try:
                        ok, latency = future.result()
                    except Exception as exc:  # noqa: BLE001
                        ok, latency = False, None
                        results[cfg.fingerprint] = ProbeResult(False, error=str(exc))
                        continue
                    results[cfg.fingerprint] = ProbeResult(ok, latency_ms=latency)
                    done += 1
                    if done % 50 == 0:
                        log(f"tcp progress {done}/{len(configs)}")
            except TimeoutError:
                log("tcp phase hit its time budget; remaining hosts count as failed")
    finally:
        socket.setdefaulttimeout(previous)
    for cfg in configs:
        results.setdefault(cfg.fingerprint, ProbeResult(False, error="timeout"))
    ok_count = sum(1 for item in results.values() if item.ok)
    log(f"tcp reachable {ok_count}/{len(configs)}")
    return results


def proxy_probe(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
    concurrency: int,
    batch_size: int = 20,
) -> dict[str, ProbeResult]:
    """Test many configs at once: several Xray processes, each with many SOCKS inbounds."""
    results: dict[str, ProbeResult] = {}
    if not configs:
        return results
    if not _curl_available():
        log("curl is missing; skipping proxy tests")
        return results
    size = max(1, batch_size)
    batches = [configs[offset : offset + size] for offset in range(0, len(configs), size)]
    workers = max(1, min(concurrency, len(batches)))
    log(f"proxy batches {len(batches)} size<={size} parallel={workers} timeout={timeout}s")
    done = 0
    waves = math.ceil(len(batches) / workers)
    budget = waves * (timeout + speed_timeout + 14) + 90
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_proxy_batch_safe, batch, xray_bin, timeout, speed_timeout): batch
            for batch in batches
        }
        try:
            for future in as_completed(futures, timeout=budget):
                batch = futures[future]
                try:
                    batch_results = future.result()
                except Exception as exc:  # noqa: BLE001
                    batch_results = {cfg.fingerprint: ProbeResult(False, error=str(exc)) for cfg in batch}
                results.update(batch_results)
                done += len(batch)
                ok_so_far = sum(1 for item in results.values() if item.ok)
                log(f"proxy progress {done}/{len(configs)} ok {ok_so_far}")
        except TimeoutError:
            log("proxy phase hit its time budget; remaining configs count as failed")
    for cfg in configs:
        results.setdefault(cfg.fingerprint, ProbeResult(False, error="timeout"))
    ok_count = sum(1 for item in results.values() if item.ok)
    log(f"proxy verified {ok_count}/{len(configs)}")
    return results


def build_xray_batch(pairs: list[tuple[VlessConfig, int]]) -> dict:
    """One Xray process: each local SOCKS port is routed only to its own VLESS outbound."""
    inbounds: list[dict] = []
    outbounds: list[dict] = [{"protocol": "blackhole", "tag": "block"}]
    rules: list[dict] = []
    for index, (cfg, port) in enumerate(pairs):
        in_tag = f"in-{index}"
        out_tag = f"out-{index}"
        inbounds.append(
            {
                "listen": "127.0.0.1",
                "port": port,
                "protocol": "socks",
                "settings": {"udp": False, "auth": "noauth"},
                "sniffing": {"enabled": False},
                "tag": in_tag,
            }
        )
        outbound = build_outbound(cfg)
        outbound["tag"] = out_tag
        outbounds.append(outbound)
        rules.append({"type": "field", "inboundTag": [in_tag], "outboundTag": out_tag})
    return {
        "log": {"loglevel": "none"},
        "inbounds": inbounds,
        "outbounds": outbounds,
        "routing": {"domainStrategy": "AsIs", "rules": rules},
    }


def build_xray_config(cfg: VlessConfig, port: int) -> dict:
    return {
        "log": {"loglevel": "none"},
        "inbounds": [
            {
                "listen": "127.0.0.1",
                "port": port,
                "protocol": "socks",
                "settings": {"udp": False, "auth": "noauth"},
                "tag": "socks-in",
            }
        ],
        "outbounds": [build_outbound(cfg)],
    }


def build_outbound(cfg: VlessConfig) -> dict:
    user: dict[str, str] = {"id": cfg.uuid, "encryption": cfg.encryption or "none"}
    if cfg.flow and cfg.network == "tcp":
        user["flow"] = cfg.flow
    if cfg.packet_encoding:
        user["packetEncoding"] = cfg.packet_encoding
    return {
        "protocol": "vless",
        "tag": "proxy",
        "settings": {"vnext": [{"address": cfg.host, "port": cfg.port, "users": [user]}]},
        "streamSettings": _stream_settings(cfg),
    }


def _stream_settings(cfg: VlessConfig) -> dict:
    network = cfg.network or "tcp"
    xray_network = {
        "tcp": "tcp",
        "ws": "ws",
        "grpc": "grpc",
        "h2": "http",
        "xhttp": "xhttp",
        "httpupgrade": "httpupgrade",
        "kcp": "kcp",
        "quic": "quic",
    }.get(network, network)
    stream: dict = {"network": xray_network}
    if cfg.security == "tls":
        tls: dict = {
            "serverName": cfg.sni or cfg.host_header or cfg.host,
            "allowInsecure": bool(cfg.allow_insecure),
        }
        if cfg.fp:
            tls["fingerprint"] = cfg.fp
        if cfg.alpn:
            tls["alpn"] = [part.strip() for part in cfg.alpn.split(",") if part.strip()]
        stream["security"] = "tls"
        stream["tlsSettings"] = tls
    elif cfg.security == "reality":
        reality: dict = {
            "serverName": cfg.sni or cfg.host_header,
            "fingerprint": cfg.fp or "chrome",
            "publicKey": cfg.pbk,
            "shortId": cfg.sid,
        }
        if cfg.spx:
            reality["spiderX"] = cfg.spx
        stream["security"] = "reality"
        stream["realitySettings"] = reality
    else:
        stream["security"] = "none"

    if network == "ws":
        ws: dict = {"path": cfg.path or "/"}
        if cfg.host_header:
            ws["host"] = cfg.host_header
            ws["headers"] = {"Host": cfg.host_header}
        stream["wsSettings"] = ws
    elif network == "grpc":
        grpc: dict = {
            "serviceName": cfg.service_name,
            "multiMode": cfg.mode.lower() in {"multi", "multimode"},
        }
        if cfg.authority:
            grpc["authority"] = cfg.authority
        stream["grpcSettings"] = grpc
    elif network == "h2":
        http: dict = {"path": cfg.path or "/"}
        if cfg.host_header:
            http["host"] = [part.strip() for part in cfg.host_header.split(",") if part.strip()]
        stream["httpSettings"] = http
    elif network == "xhttp":
        xhttp: dict = {"path": cfg.path or "/", "mode": cfg.mode or "auto"}
        if cfg.host_header:
            xhttp["host"] = cfg.host_header
        extra = _json_object(cfg.extra)
        if extra is not None:
            xhttp["extra"] = extra
        stream["xhttpSettings"] = xhttp
    elif network == "httpupgrade":
        upgrade: dict = {"path": cfg.path or "/"}
        if cfg.host_header:
            upgrade["host"] = cfg.host_header
        stream["httpupgradeSettings"] = upgrade
    elif network == "tcp" and cfg.header_type.lower() == "http":
        header: dict = {"type": "http", "request": {}}
        if cfg.path:
            header["request"]["path"] = [cfg.path]
        if cfg.host_header:
            header["request"]["headers"] = {"Host": [cfg.host_header]}
        stream["tcpSettings"] = {"header": header}
    elif network == "kcp":
        stream["kcpSettings"] = {"header": {"type": cfg.header_type or "none"}}
    return stream


def _json_object(value: str) -> dict | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _tcp_one(host: str, port: int, timeout: float) -> tuple[bool, float | None]:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, round((time.perf_counter() - started) * 1000, 1)
    except OSError:
        return False, None


def _proxy_batch_safe(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
) -> dict[str, ProbeResult]:
    try:
        return _run_batch(configs, xray_bin, timeout, speed_timeout, allow_split=True)
    except Exception as exc:  # noqa: BLE001
        return {cfg.fingerprint: ProbeResult(False, error=str(exc)) for cfg in configs}


def _run_batch(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
    *,
    allow_split: bool,
) -> dict[str, ProbeResult]:
    if not configs:
        return {}
    ports: list[int] = []
    try:
        ports = [_alloc_port() for _ in configs]
        with tempfile.TemporaryDirectory(prefix="vlesshub-") as tmp:
            config_path = Path(tmp) / "config.json"
            log_path = Path(tmp) / "xray.log"
            pairs = list(zip(configs, ports, strict=True))
            config_path.write_text(json.dumps(build_xray_batch(pairs)), encoding="utf-8")
            log_handle = log_path.open("w", encoding="utf-8")
            proc = subprocess.Popen(
                [str(xray_bin), "run", "-c", str(config_path)],
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                ready = _wait_ports(ports, proc, 5.0)
                if not ready:
                    exited = proc.poll() is not None
                    if allow_split and exited and len(configs) > 1:
                        _kill(proc)
                        log_handle.close()
                        for port in ports:
                            _release_port(port)
                        ports = []
                        mid = len(configs) // 2
                        left = _run_batch(
                            configs[:mid], xray_bin, timeout, speed_timeout, allow_split=False
                        )
                        right = _run_batch(
                            configs[mid:], xray_bin, timeout, speed_timeout, allow_split=False
                        )
                        return {**left, **right}
                    error = _tail(log_path) or ("xray exited" if exited else "xray not listening")
                    return {cfg.fingerprint: ProbeResult(False, error=error) for cfg in configs}
                return _curl_batch(pairs, timeout, speed_timeout)
            finally:
                log_handle.close()
                _kill(proc)
    finally:
        for port in ports:
            _release_port(port)


def _curl_batch(
    pairs: list[tuple[VlessConfig, int]],
    timeout: float,
    speed_timeout: float,
) -> dict[str, ProbeResult]:
    results: dict[str, ProbeResult] = {}

    def one(cfg: VlessConfig, port: int) -> ProbeResult:
        code, latency, _size = _curl(port, _GENERATE_204, timeout)
        if code not in {200, 204} or latency <= 0:
            return ProbeResult(False, error=f"http {code}")
        speed = _measure_speed(port, speed_timeout)
        return ProbeResult(True, latency_ms=round(latency, 1), speed_kbps=speed)

    workers = max(1, len(pairs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, cfg, port): cfg for cfg, port in pairs}
        for future in as_completed(futures):
            cfg = futures[future]
            try:
                results[cfg.fingerprint] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[cfg.fingerprint] = ProbeResult(False, error=str(exc))
    return results


def _measure_speed(port: int, timeout: float) -> float | None:
    if timeout <= 0:
        return None
    code, elapsed_ms, size = _curl(port, _SPEED, timeout)
    if code != 200 or size <= 0 or elapsed_ms <= 0:
        return None
    return round((size / 1024) / (elapsed_ms / 1000), 1)


def _curl(port: int, url: str, timeout: float) -> tuple[int, float, int]:
    command = [
        "curl",
        "-sS",
        "-o",
        os.devnull,
        "--connect-timeout",
        str(max(2, int(timeout // 2) or 2)),
        "--max-time",
        str(max(3, int(timeout))),
        "-w",
        "%{http_code} %{time_total} %{size_download}",
        "--socks5-hostname",
        f"127.0.0.1:{port}",
        url,
    ]
    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout + 4,
        )
    except subprocess.TimeoutExpired:
        return 0, 0.0, 0
    parts = (proc.stdout or "").split()
    if len(parts) < 2:
        return 0, 0.0, 0
    code = int(parts[0]) if parts[0].isdigit() else 0
    try:
        elapsed_ms = float(parts[1]) * 1000
    except ValueError:
        elapsed_ms = 0.0
    try:
        size = int(float(parts[2])) if len(parts) > 2 else 0
    except ValueError:
        size = 0
    return code, elapsed_ms, size


def _wait_ports(ports: list[int], proc: subprocess.Popen, timeout: float) -> bool:
    deadline = time.perf_counter() + timeout
    pending = set(ports)
    while pending and time.perf_counter() < deadline:
        if proc.poll() is not None:
            return False
        for port in list(pending):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    pending.discard(port)
            except OSError:
                pass
        if pending:
            time.sleep(0.05)
    return not pending


def _kill(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        proc.kill()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()


def _alloc_port() -> int:
    with _ports_lock:
        for _ in range(100):
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = int(sock.getsockname()[1])
            if port not in _ports:
                _ports.add(port)
                return port
    raise RuntimeError("no free local port")


def _release_port(port: int) -> None:
    with _ports_lock:
        _ports.discard(port)


def _curl_available() -> bool:
    from shutil import which

    return which("curl") is not None


def _tail(path: Path, limit: int = 300) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return " ".join(text.split())[:limit]
