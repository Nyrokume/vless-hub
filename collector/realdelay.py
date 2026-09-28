"""Real-delay probe: one Xray process per batch, HTTP 204 through each SOCKS inbound.

This is the same idea as v2rayN / Happ "real delay": the request goes through the
VLESS outbound, and only an HTTP 204 counts. TCP connect is a pre-filter and is
never stored as the published delay.
"""

from __future__ import annotations

import json
import socket
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from xraycfg import batch_config, outbound

GENERATE_URLS = (
    "https://www.gstatic.com/generate_204",
    "https://cp.cloudflare.com/generate_204",
)


def tcp_open(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _port_free(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def reserve_ports(count: int, start: int = 28080) -> list[int]:
    base = start
    while base < 50000:
        ports = list(range(base, base + count))
        if all(_port_free(port) for port in ports):
            return ports
        base += count
    raise RuntimeError("no free local ports for the Xray batch")


def _curl_code(port: int, url: str, timeout: float) -> tuple[int, int] | None:
    """Return (http_code, milliseconds) for one request through a local SOCKS port."""
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
                "--socks5-hostname",
                f"127.0.0.1:{port}",
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
        return None
    parts = (completed.stdout or "").split()
    if len(parts) != 2:
        return None
    try:
        code = int(parts[0])
        elapsed = max(1, int(float(parts[1]) * 1000))
    except ValueError:
        return None
    return code, elapsed


def one_attempt(port: int, timeout: float) -> int | None:
    """Time to a 204. gstatic first, Cloudflare only if that attempt is not a 204."""
    for url in GENERATE_URLS:
        result = _curl_code(port, url, timeout)
        if result and result[0] == 204:
            return result[1]
    return None


def median_delay(port: int, attempts: int, timeout: float) -> tuple[int | None, int]:
    samples: list[int] = []
    for _ in range(attempts):
        sample = one_attempt(port, timeout)
        if sample is not None:
            samples.append(sample)
    if not samples:
        return None, 0
    ordered = sorted(samples)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        value = ordered[mid]
    else:
        value = (ordered[mid - 1] + ordered[mid]) // 2
    return value, len(samples)


class XrayBatch:
    def __init__(self, binary: str, document: dict):
        self.binary = binary
        self.document = document
        self._dir: tempfile.TemporaryDirectory[str] | None = None
        self.process: subprocess.Popen[str] | None = None
        self.errors: list[str] = []

    def __enter__(self) -> XrayBatch:
        self._dir = tempfile.TemporaryDirectory(prefix="vless-hub-xray-")
        path = Path(self._dir.name) / "config.json"
        path.write_text(json.dumps(self.document), encoding="utf-8")
        self._log_path = Path(self._dir.name) / "xray.log"
        self._log_file = self._log_path.open("w", encoding="utf-8")
        self.process = subprocess.Popen(
            [self.binary, "run", "-c", str(path)],
            stdout=self._log_file,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.perf_counter() + 8
        while time.perf_counter() < deadline:
            if self.process.poll() is not None:
                self._log_file.flush()
                error = self._log_path.read_text(encoding="utf-8", errors="replace")[-500:]
                raise RuntimeError(f"xray exited early: {error}")
            ports = [item["port"] for item in self.document["inbounds"]]
            if ports and not _port_free(ports[0]):
                return self
            time.sleep(0.1)
        raise RuntimeError("xray did not open its SOCKS inbound")

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if getattr(self, "_log_file", None):
            self._log_file.close()
        if self._dir:
            self._dir.cleanup()


def probe_batch(
    binary: str,
    configs: list[dict],
    attempts: int,
    timeout: float,
) -> list[dict]:
    usable = [config for config in configs if outbound(config, "probe") is not None]
    if not usable:
        return []
    ports = reserve_ports(len(usable))
    document = batch_config(list(zip(ports, usable)))
    if document is None:
        return []
    kept_ports = [item["port"] for item in document["inbounds"]]
    kept_configs = usable[: len(kept_ports)]
    passed: list[dict] = []
    with XrayBatch(binary, document):
        with ThreadPoolExecutor(max_workers=max(1, len(kept_configs))) as pool:
            futures = {
                pool.submit(median_delay, port, attempts, timeout): config
                for port, config in zip(kept_ports, kept_configs)
            }
            for future in as_completed(futures):
                config = futures[future]
                delay, successes = future.result()
                if delay is None:
                    continue
                record = dict(config)
                record["delay_ms"] = delay
                record["latency_ms"] = delay
                record["check"] = "real"
                record["successes"] = successes
                passed.append(record)
    return passed


def probe_vless(
    configs: list[dict],
    binary: str,
    batch_size: int,
    attempts: int,
    timeout: float,
) -> list[dict]:
    passed: list[dict] = []
    size = max(1, batch_size)
    for offset in range(0, len(configs), size):
        chunk = configs[offset : offset + size]
        print(f"real-delay batch {offset + 1}-{offset + len(chunk)} / {len(configs)}")
        try:
            found = probe_batch(binary, chunk, attempts, timeout)
        except (OSError, RuntimeError) as error:
            print(f"real-delay batch failed: {error}")
            if len(chunk) == 1:
                continue
            mid = max(1, len(chunk) // 2)
            passed.extend(probe_vless(chunk[:mid], binary, mid, attempts, timeout))
            passed.extend(probe_vless(chunk[mid:], binary, mid, attempts, timeout))
            continue
        passed.extend(found)
        print(f"  passed {len(found)}")
    return passed
