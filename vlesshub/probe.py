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
from vlesshub.stages import (
    CONFIG_BUDGET_SEC,
    EXIT_URL,
    HTTP_TARGETS,
    HttpSample,
    REQUEST_TIMEOUT_SEC,
    MIN_SPEED_BYTES,
    SPEED_URL,
    assess_proxy,
    classify_failure,
    parse_exit_ip,
    response_ok,
)
from vlesshub.util import log

# Time to first byte of one HTTP response. The core is already listening, and curl does not retry.
_CURL_WRITE = "%{http_code} %{time_starttransfer} %{time_total} %{size_download}"
_TLS_EXITS = {35, 51, 53, 54, 58, 59, 60, 64, 77, 80, 82, 83, 90, 91}
_ports_lock = threading.Lock()
_ports: set[int] = set()


@dataclass(slots=True)
class ProbeResult:
    ok: bool
    latency_ms: float | None = None
    speed_kbps: float | None = None
    error: str = ""
    handshake_ms: float | None = None
    stage: str = ""
    reason: str = ""
    exit_ip: str = ""
    # False when the phase budget ended before this config was tested.
    evaluated: bool = True


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
                        ok, latency, error = future.result()
                    except Exception as exc:  # noqa: BLE001
                        results[cfg.fingerprint] = ProbeResult(
                            False,
                            error=str(exc),
                            stage="tcp",
                            reason=classify_failure("tcp", str(exc)),
                        )
                        continue
                    reason = "" if ok else ("timeout" if error == "timeout" else "tcp_refused")
                    results[cfg.fingerprint] = ProbeResult(
                        ok,
                        latency_ms=latency,
                        error="" if ok else error,
                        stage="" if ok else "tcp",
                        reason=reason,
                    )
                    done += 1
                    if done % 50 == 0:
                        log(f"tcp progress {done}/{len(configs)}")
            except TimeoutError:
                log("tcp phase hit its time budget; remaining hosts count as failed")
    finally:
        socket.setdefaulttimeout(previous)
    for cfg in configs:
        results.setdefault(
            cfg.fingerprint,
            ProbeResult(False, error="timeout", stage="tcp", reason="timeout"),
        )
    ok_count = sum(1 for item in results.values() if item.ok)
    log(f"tcp reachable {ok_count}/{len(configs)}")
    return results


def failure_reason(result: ProbeResult | None) -> str:
    """Stable reason for a finished failure. Untested configs are not failures."""
    if result is None or result.ok or not result.evaluated:
        return ""
    if result.reason:
        return result.reason
    return classify_failure(result.stage or "http", result.error or "timeout")


def proxy_probe(
    configs: list[VlessConfig],
    xray_bin: Path | None,
    timeout: float,
    speed_timeout: float,
    concurrency: int,
    batch_size: int = 20,
    singbox_bin: Path | None = None,
) -> dict[str, ProbeResult]:
    """Test VLESS, Shadowsocks, and Trojan with Xray, and Hysteria2 with sing-box."""
    hy2 = [cfg for cfg in configs if cfg.protocol == "hysteria2"]
    rest = [cfg for cfg in configs if cfg.protocol != "hysteria2"]
    results: dict[str, ProbeResult] = {}
    direct = fetch_runner_ip()
    log(f"runner exit {direct or 'unknown'}")
    if rest:
        if xray_bin is None:
            results.update(
                {
                    cfg.fingerprint: ProbeResult(
                        False, error="xray unavailable", stage="handshake", reason="handshake_fail"
                    )
                    for cfg in rest
                }
            )
        else:
            results.update(
                _proxy_probe_xray(
                    rest, xray_bin, timeout, speed_timeout, concurrency, batch_size, direct
                )
            )
    if hy2:
        if singbox_bin is None:
            results.update(
                {
                    cfg.fingerprint: ProbeResult(
                        False, error="sing-box unavailable", stage="handshake", reason="handshake_fail"
                    )
                    for cfg in hy2
                }
            )
        else:
            results.update(
                _proxy_probe_singbox(
                    hy2, singbox_bin, timeout, speed_timeout, concurrency, batch_size, direct
                )
            )
    return results


def _wave_budget(batch_count: int, workers: int) -> float:
    """Wall clock for every wave. Each config has its own CONFIG_BUDGET_SEC after the core is up."""
    waves = max(1, math.ceil(batch_count / max(1, workers)))
    return waves * (CONFIG_BUDGET_SEC + 12) + 90


def _proxy_probe_xray(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
    concurrency: int,
    batch_size: int = 20,
    runner_ip: str = "",
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
    budget = _wave_budget(len(batches), workers)
    log(
        f"proxy batches {len(batches)} size<={size} parallel={workers} "
        f"request={REQUEST_TIMEOUT_SEC}s budget={CONFIG_BUDGET_SEC}s wave={budget:.0f}s"
    )
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_proxy_batch_safe, batch, xray_bin, timeout, speed_timeout, runner_ip): batch
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
            log("proxy phase hit its time budget; untested configs are left unevaluated")
    for cfg in configs:
        results.setdefault(cfg.fingerprint, ProbeResult(False, error="budget", evaluated=False))
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
    if cfg.protocol == "shadowsocks":
        return {
            "protocol": "shadowsocks",
            "tag": "proxy",
            "settings": {
                "servers": [
                    {
                        "address": cfg.host,
                        "port": cfg.port,
                        "method": cfg.encryption,
                        "password": cfg.uuid,
                    }
                ]
            },
            "streamSettings": {"network": "tcp", "security": "none"},
        }
    if cfg.protocol == "trojan":
        return {
            "protocol": "trojan",
            "tag": "proxy",
            "settings": {"servers": [{"address": cfg.host, "port": cfg.port, "password": cfg.uuid}]},
            "streamSettings": _stream_settings(cfg),
        }
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
            hosts = [part.strip() for part in cfg.host_header.split(",") if part.strip()]
            if hosts:
                header["request"]["headers"] = {"Host": hosts}
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


def _tcp_one(host: str, port: int, timeout: float) -> tuple[bool, float | None, str]:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, round((time.perf_counter() - started) * 1000, 1), ""
    except TimeoutError:
        return False, None, "timeout"
    except OSError:
        return False, None, "tcp_refused"


def _handshake_results(configs: list[VlessConfig], error: str) -> dict[str, ProbeResult]:
    results: dict[str, ProbeResult] = {}
    for cfg in configs:
        reason = classify_failure("handshake", error or "xray not listening", cfg.security)
        results[cfg.fingerprint] = ProbeResult(False, error=error, stage="handshake", reason=reason)
    return results


def _proxy_batch_safe(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
    runner_ip: str = "",
) -> dict[str, ProbeResult]:
    try:
        return _run_batch(configs, xray_bin, timeout, speed_timeout, runner_ip, allow_split=True)
    except Exception as exc:  # noqa: BLE001
        return _handshake_results(configs, str(exc))


def _run_batch(
    configs: list[VlessConfig],
    xray_bin: Path,
    timeout: float,
    speed_timeout: float,
    runner_ip: str = "",
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
                            configs[:mid],
                            xray_bin,
                            timeout,
                            speed_timeout,
                            runner_ip,
                            allow_split=False,
                        )
                        right = _run_batch(
                            configs[mid:],
                            xray_bin,
                            timeout,
                            speed_timeout,
                            runner_ip,
                            allow_split=False,
                        )
                        return {**left, **right}
                    error = _tail(log_path) or ("xray exited" if exited else "xray not listening")
                    return _handshake_results(configs, error)
                return _curl_batch(pairs, timeout, speed_timeout, runner_ip)
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
    runner_ip: str = "",
) -> dict[str, ProbeResult]:
    del speed_timeout  # Throughput always runs inside the per-config budget.
    results: dict[str, ProbeResult] = {}
    per_request = min(float(timeout) if timeout else REQUEST_TIMEOUT_SEC, REQUEST_TIMEOUT_SEC)

    def one(cfg: VlessConfig, port: int) -> ProbeResult:
        return _probe_through_core(cfg, port, per_request, runner_ip)

    workers = max(1, len(pairs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, cfg, port): cfg for cfg, port in pairs}
        for future in as_completed(futures):
            cfg = futures[future]
            try:
                results[cfg.fingerprint] = future.result()
            except Exception as exc:  # noqa: BLE001
                results[cfg.fingerprint] = ProbeResult(
                    False,
                    error=str(exc),
                    stage="handshake",
                    reason=classify_failure("handshake", str(exc), cfg.security),
                )
    return results


def _probe_through_core(cfg: VlessConfig, port: int, per_request: float, runner_ip: str) -> ProbeResult:
    """Warmup, then majority HTTP, a payload, and an exit address. Core startup is already done."""
    deadline = time.perf_counter() + CONFIG_BUDGET_SEC

    def once(url: str, *, read_body: bool = False) -> HttpSample:
        left = deadline - time.perf_counter()
        if left < 0.4:
            return HttpSample(timed_out=True)
        return _curl(port, url, min(per_request, left), read_body=read_body)

    def with_retry(url: str, expected: frozenset[int], kind: str) -> list[HttpSample]:
        read_body = kind == "page"
        first = once(url, read_body=read_body)
        # A real status is an answer. Retry only silence, so a dead proxy does not sit twice.
        definitive = first.code > 0 and not first.timed_out and not first.tls_error
        if response_ok(first, expected, kind) or definitive or deadline - time.perf_counter() < 0.4:
            return [first]
        return [first, once(url, read_body=read_body)]

    warm = HTTP_TARGETS[0]
    warm_attempts = with_retry(warm.url, warm.codes, warm.kind)
    warmup = next(
        (sample for sample in warm_attempts if response_ok(sample, warm.codes, warm.kind)),
        warm_attempts[-1],
    )
    if not response_ok(warmup, warm.codes, warm.kind):
        return _from_assessment(
            assess_proxy(
                security=cfg.security,
                warmup=warmup,
                targets=[],
                speed=None,
                exit_body="",
                exit_timed_out=False,
                runner_ip=runner_ip,
            )
        )

    # The warmup is already the first endpoint, so it counts as one of the three.
    targets: list[tuple[str, frozenset[int], list[HttpSample]]] = [
        (warm.kind, warm.codes, warm_attempts)
    ]
    for check in HTTP_TARGETS[1:]:
        if deadline - time.perf_counter() < 0.4:
            targets.append((check.kind, check.codes, []))
            continue
        targets.append((check.kind, check.codes, with_retry(check.url, check.codes, check.kind)))

    hits = sum(
        1
        for kind, expected, attempts in targets
        if any(response_ok(sample, expected, kind) for sample in attempts)
    )
    if hits * 2 <= len(HTTP_TARGETS):
        return _from_assessment(
            assess_proxy(
                security=cfg.security,
                warmup=warmup,
                targets=targets,
                speed=None,
                exit_body="",
                exit_timed_out=False,
                runner_ip=runner_ip,
            )
        )

    speed = once(SPEED_URL)
    if speed.size < MIN_SPEED_BYTES or speed.total_ms <= 0:
        return _from_assessment(
            assess_proxy(
                security=cfg.security,
                warmup=warmup,
                targets=targets,
                speed=speed,
                exit_body="",
                exit_timed_out=False,
                runner_ip=runner_ip,
            )
        )

    exit_sample = once(EXIT_URL, read_body=True)
    return _from_assessment(
        assess_proxy(
            security=cfg.security,
            warmup=warmup,
            targets=targets,
            speed=speed,
            exit_body=exit_sample.body,
            exit_timed_out=exit_sample.timed_out,
            runner_ip=runner_ip,
        )
    )


def _from_assessment(assessment) -> ProbeResult:
    return ProbeResult(
        assessment.ok,
        latency_ms=assessment.latency_ms,
        speed_kbps=assessment.speed_kbps,
        error="" if assessment.ok else assessment.reason,
        handshake_ms=assessment.handshake_ms,
        stage="" if assessment.ok else assessment.stage,
        reason="" if assessment.ok else assessment.reason,
        exit_ip=assessment.exit_ip,
    )


def _curl(port: int, url: str, timeout: float, *, read_body: bool = False) -> HttpSample:
    body_path = ""
    if read_body:
        handle = tempfile.NamedTemporaryFile(prefix="vlesshub-body-", delete=False)
        body_path = handle.name
        handle.close()
    command = [
        "curl",
        "-sS",
        "-o",
        body_path or os.devnull,
        "--connect-timeout",
        str(max(2, int(min(timeout, 3)) or 2)),
        "--max-time",
        f"{max(1.0, timeout):.1f}",
        "--retry",
        "0",
        "-w",
        _CURL_WRITE,
        "--socks5-hostname",
        f"127.0.0.1:{port}",
        url,
    ]
    timed_out = False
    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout + 2,
        )
        code, start_ms, total_ms, size = parse_curl_write(proc.stdout or "")
        timed_out = proc.returncode == 28
        stderr = (proc.stderr or "").lower()
        tls_error = proc.returncode in _TLS_EXITS or "ssl" in stderr
    except subprocess.TimeoutExpired:
        code, start_ms, total_ms, size = 0, 0.0, 0.0, 0
        timed_out = True
        tls_error = False
    body = ""
    if body_path:
        try:
            body = Path(body_path).read_text(encoding="utf-8", errors="replace")[:800]
        except OSError:
            body = ""
        Path(body_path).unlink(missing_ok=True)
    return HttpSample(code, start_ms, total_ms, size, timed_out, body, tls_error)


def fetch_runner_ip(timeout: float = REQUEST_TIMEOUT_SEC) -> str:
    """Address of this runner, fetched directly so a proxy exit can be compared to it."""
    command = [
        "curl",
        "-fsS",
        "--max-time",
        f"{timeout:.0f}",
        "--retry",
        "0",
        EXIT_URL,
    ]
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout + 2)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if proc.returncode != 0:
        return ""
    return parse_exit_ip(proc.stdout or "")


def parse_curl_write(stdout: str) -> tuple[int, float, float, int]:
    """Return HTTP code, time-to-first-byte ms, total ms, and download size."""
    parts = stdout.split()
    if len(parts) < 3:
        return 0, 0.0, 0.0, 0
    code = int(parts[0]) if parts[0].isdigit() else 0
    try:
        start_ms = round(float(parts[1]) * 1000, 1)
    except ValueError:
        start_ms = 0.0
    try:
        total_ms = round(float(parts[2]) * 1000, 1)
    except ValueError:
        total_ms = 0.0
    try:
        size = int(float(parts[3])) if len(parts) > 3 else 0
    except ValueError:
        size = 0
    return code, start_ms, total_ms, size


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


def _proxy_probe_singbox(
    configs: list[VlessConfig],
    singbox_bin: Path,
    timeout: float,
    speed_timeout: float,
    concurrency: int,
    batch_size: int,
    runner_ip: str = "",
) -> dict[str, ProbeResult]:
    results: dict[str, ProbeResult] = {}
    if not _curl_available():
        return _handshake_results(configs, "curl missing")
    size = max(1, min(batch_size, 8))
    batches = [configs[offset : offset + size] for offset in range(0, len(configs), size)]
    workers = max(1, min(concurrency, len(batches)))
    budget = _wave_budget(len(batches), workers)
    log(f"hysteria2 batches {len(batches)} size<={size} parallel={workers} wave={budget:.0f}s")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _run_singbox_batch,
                batch,
                singbox_bin,
                timeout,
                speed_timeout,
                runner_ip,
                allow_split=True,
            ): batch
            for batch in batches
        }
        try:
            for future in as_completed(futures, timeout=budget):
                batch = futures[future]
                try:
                    results.update(future.result())
                except Exception as exc:  # noqa: BLE001
                    results.update(_handshake_results(batch, str(exc)))
        except TimeoutError:
            log("hysteria2 phase hit its time budget; untested configs are left unevaluated")
    for cfg in configs:
        results.setdefault(cfg.fingerprint, ProbeResult(False, error="budget", evaluated=False))
    ok_count = sum(1 for cfg in configs if results[cfg.fingerprint].ok)
    log(f"hysteria2 verified {ok_count}/{len(configs)}")
    return results


def build_hy2_outbound(cfg: VlessConfig) -> dict:
    item: dict = {
        "type": "hysteria2",
        "tag": "proxy",
        "server": cfg.host,
        "server_port": cfg.port,
        "password": cfg.uuid,
        "tls": {
            "enabled": True,
            "server_name": cfg.sni or cfg.host,
            "insecure": bool(cfg.allow_insecure),
            "alpn": ["h3"],
        },
    }
    obfs = cfg.extras.get("obfs", "")
    if obfs:
        item["obfs"] = {"type": obfs, "password": cfg.extras.get("obfs-password", "")}
    return item


def build_singbox_batch(pairs: list[tuple[VlessConfig, int]]) -> dict:
    inbounds: list[dict] = []
    outbounds: list[dict] = []
    rules: list[dict] = []
    for index, (cfg, port) in enumerate(pairs):
        in_tag = f"in-{index}"
        out_tag = f"out-{index}"
        inbounds.append({"type": "socks", "tag": in_tag, "listen": "127.0.0.1", "listen_port": port})
        outbound = build_hy2_outbound(cfg)
        outbound["tag"] = out_tag
        outbounds.append(outbound)
        rules.append({"inbound": in_tag, "outbound": out_tag})
    return {"log": {"level": "error"}, "inbounds": inbounds, "outbounds": outbounds, "route": {"rules": rules}}


def _run_singbox_batch(
    configs: list[VlessConfig],
    singbox_bin: Path,
    timeout: float,
    speed_timeout: float,
    runner_ip: str = "",
    *,
    allow_split: bool,
) -> dict[str, ProbeResult]:
    if not configs:
        return {}
    ports: list[int] = []
    try:
        ports = [_alloc_port() for _ in configs]
        with tempfile.TemporaryDirectory(prefix="vlesshub-hy2-") as tmp:
            config_path = Path(tmp) / "config.json"
            log_path = Path(tmp) / "singbox.log"
            pairs = list(zip(configs, ports, strict=True))
            config_path.write_text(json.dumps(build_singbox_batch(pairs)), encoding="utf-8")
            log_handle = log_path.open("w", encoding="utf-8")
            proc = subprocess.Popen(
                [str(singbox_bin), "run", "-c", str(config_path)],
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
                        left = _run_singbox_batch(
                            configs[:mid],
                            singbox_bin,
                            timeout,
                            speed_timeout,
                            runner_ip,
                            allow_split=False,
                        )
                        right = _run_singbox_batch(
                            configs[mid:],
                            singbox_bin,
                            timeout,
                            speed_timeout,
                            runner_ip,
                            allow_split=False,
                        )
                        return {**left, **right}
                    error = _tail(log_path) or ("sing-box exited" if exited else "sing-box not listening")
                    return _handshake_results(configs, error)
                return _curl_batch(pairs, timeout, speed_timeout, runner_ip)
            finally:
                log_handle.close()
                _kill(proc)
    finally:
        for port in ports:
            _release_port(port)


def _tail(path: Path, limit: int = 300) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    return " ".join(text.split())[:limit]
