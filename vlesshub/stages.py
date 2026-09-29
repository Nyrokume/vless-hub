"""Pure rules for the multi-stage probe: reasons, majority, ping, and status."""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field

@dataclass(frozen=True, slots=True)
class HttpTarget:
    """One HTTPS check. ``empty`` is a generate_204; ``page`` is a real document."""

    url: str
    codes: frozenset[int]
    kind: str


HTTP_TARGETS: tuple[HttpTarget, ...] = (
    HttpTarget("https://www.gstatic.com/generate_204", frozenset({204}), "empty"),
    HttpTarget("https://cp.cloudflare.com/generate_204", frozenset({204}), "empty"),
    HttpTarget("https://example.com/", frozenset({200}), "page"),
)
PAGE_MARK = "Example Domain"
SPEED_URL = "https://speed.cloudflare.com/__down?bytes=250000"
SPEED_BYTES = 250_000
# A zombie answers the socket but does not move a real payload.
MIN_SPEED_BYTES = 50_000
EXIT_URL = "https://api.ipify.org"
REQUEST_TIMEOUT_SEC = 5.0
CONFIG_BUDGET_SEC = 20.0
STABILITY_WINDOW = 10
STABILITY_MIN_RATE = 0.7

REASONS = (
    "parse_error",
    "invalid_field",
    "unsupported_protocol",
    "tcp_refused",
    "timeout",
    "tls_fail",
    "reality_fail",
    "handshake_fail",
    "http_fail",
    "no_data",
    "exit_ip_leak",
    "mtproto_fail",
    "socks_fail",
    "export_mismatch",
    "flaky",
)


def classify_failure(stage: str, error: str, security: str = "") -> str:
    """Map a failed stage to a stable reason code."""
    err = (error or "").lower()
    timed_out = "timeout" in err or "timed out" in err or err in {"http 0", "0"}
    if stage == "parse":
        return "invalid_field" if "invalid" in err else "parse_error"
    if stage == "tcp":
        return "timeout" if timed_out else "tcp_refused"
    if stage == "handshake":
        if timed_out:
            return "timeout"
        if security == "reality" or "reality" in err:
            return "reality_fail"
        if security == "tls" or "tls" in err or "handshake" in err:
            return "tls_fail"
        return "handshake_fail"
    if stage == "http":
        if timed_out:
            return "timeout"
        if "tls" in err or "ssl" in err:
            return "tls_fail"
        return "http_fail"
    if stage == "throughput":
        return "timeout" if timed_out else "no_data"
    if stage == "exit":
        return "timeout" if timed_out else "exit_ip_leak"
    return "timeout" if timed_out else "http_fail"


def majority(successes: int, total: int) -> bool:
    if total <= 0:
        return False
    return successes * 2 > total


def median_ms(samples: list[float]) -> float | None:
    clean = [float(item) for item in samples if item is not None and float(item) > 0]
    if not clean:
        return None
    return round(float(statistics.median(clean)), 1)


def status_of(passed_now: bool, bits: str, *, min_rate: float = STABILITY_MIN_RATE) -> str:
    """A config is working only when this run passed. History does not keep a failure."""
    del bits, min_rate
    return "working" if passed_now else "dead"


def note_bits(previous: str, ok: bool, window: int = STABILITY_WINDOW) -> str:
    bit = "1" if ok else "0"
    return (previous + bit)[-window:]


def fail_streak(bits: str) -> int:
    streak = 0
    for char in reversed(bits):
        if char != "0":
            break
        streak += 1
    return streak


def dropped_after(bits: str, limit: int) -> bool:
    return limit > 0 and fail_streak(bits) >= limit


def exit_leaks(exit_ip: str, runner_ip: str) -> bool:
    left = (exit_ip or "").strip()
    right = (runner_ip or "").strip()
    return bool(left) and bool(right) and left == right


def success_rate(bits: str) -> float | None:
    window = [char == "1" for char in bits if char in {"0", "1"}]
    if not window:
        return None
    return round(sum(1 for item in window if item) / len(window), 4)


@dataclass(slots=True)
class HttpSample:
    """One HTTP attempt through an already-listening core."""

    code: int = 0
    start_ms: float = 0.0
    total_ms: float = 0.0
    size: int = 0
    timed_out: bool = False
    body: str = ""
    tls_error: bool = False


@dataclass(slots=True)
class ProxyAssessment:
    ok: bool
    stage: str
    reason: str
    latency_ms: float | None = None
    handshake_ms: float | None = None
    speed_kbps: float | None = None
    exit_ip: str = ""
    samples: list[float] = field(default_factory=list)


_CAPTIVE = (
    "captive portal",
    "wifi login",
    "hotspot login",
    "please log in",
    "sign in to the network",
    "click here to login",
)


def _captive(body: str) -> bool:
    text = (body or "").lower()
    return any(marker in text for marker in _CAPTIVE)


def response_ok(sample: HttpSample | None, expected: frozenset[int], kind: str = "empty") -> bool:
    """Status and body must both match. A portal page or a TLS error is a miss."""
    if sample is None or sample.timed_out or sample.tls_error or sample.start_ms <= 0:
        return False
    if sample.code not in expected:
        return False
    if _captive(sample.body):
        return False
    if kind == "page":
        return PAGE_MARK in (sample.body or "")
    return sample.size <= 64


def attempt_ok(sample: HttpSample | None, expected: frozenset[int]) -> bool:
    return response_ok(sample, expected, "empty")


def parse_exit_ip(body: str) -> str:
    text = (body or "").strip()
    if not text:
        return ""
    token = text.split()[0].strip()
    if token.count(".") == 3:
        parts = token.split(".")
        if all(part.isdigit() and 0 <= int(part) <= 255 for part in parts):
            return token
        return ""
    if ":" in token and 2 <= token.count(":") <= 7 and all(char in "0123456789abcdefABCDEF:" for char in token):
        return token.lower()
    return ""


def _target_hit(attempts: list[HttpSample], expected: frozenset[int], kind: str) -> HttpSample | None:
    for sample in attempts:
        if response_ok(sample, expected, kind):
            return sample
    return None


def _target_timed_out(attempts: list[HttpSample]) -> bool:
    if not attempts:
        return True
    return all(sample.timed_out for sample in attempts)


def assess_proxy(
    *,
    security: str,
    warmup: HttpSample | None,
    targets: list[tuple[str, frozenset[int], list[HttpSample]]],
    speed: HttpSample | None,
    exit_body: str,
    exit_timed_out: bool,
    runner_ip: str,
) -> ProxyAssessment:
    """Decide a config from warmup, HTTP targets, a payload, and the exit address.

    Ping is the median time-to-first-byte of the successful measured targets.
    The warmup request is the handshake and is not part of that median.
    """
    warm = HTTP_TARGETS[0]
    if not response_ok(warmup, warm.codes, warm.kind):
        if warmup is not None and warmup.tls_error:
            error = "tls"
        elif warmup is None or warmup.timed_out:
            error = "timeout"
        elif warmup.code == 0:
            error = "connection failed"
        else:
            error = f"http {warmup.code}"
        return ProxyAssessment(
            False,
            "handshake",
            classify_failure("handshake", error, security),
        )

    hits: list[float] = []
    timeout_misses = 0
    tls_misses = 0
    other_misses = 0
    for kind, expected, attempts in targets:
        hit = _target_hit(attempts, expected, kind)
        if hit is not None:
            hits.append(hit.start_ms)
        elif attempts and any(sample.tls_error for sample in attempts) and _target_timed_out(attempts) is False:
            if all(sample.tls_error or sample.timed_out for sample in attempts):
                tls_misses += 1
            else:
                other_misses += 1
        elif _target_timed_out(attempts):
            timeout_misses += 1
        else:
            other_misses += 1
    total = len(targets)
    if not majority(len(hits), total):
        if other_misses == 0 and tls_misses > 0:
            error = "tls"
        elif other_misses == 0:
            error = "timeout"
        else:
            error = "http fail"
        return ProxyAssessment(
            False,
            "http",
            classify_failure("http", error, security),
            handshake_ms=round(warmup.start_ms, 1),
        )

    handshake_ms = round(warmup.start_ms, 1)
    latency = median_ms(hits)
    if speed is None or (speed.timed_out and speed.size < MIN_SPEED_BYTES):
        return ProxyAssessment(
            False,
            "throughput",
            "timeout",
            handshake_ms=handshake_ms,
            latency_ms=latency,
        )
    if speed.size < MIN_SPEED_BYTES or speed.total_ms <= 0:
        return ProxyAssessment(
            False,
            "throughput",
            classify_failure("throughput", "short body", security),
            handshake_ms=handshake_ms,
            latency_ms=latency,
        )
    speed_kbps = round((speed.size / 1024) / (speed.total_ms / 1000), 1)

    if exit_timed_out:
        return ProxyAssessment(
            False,
            "exit",
            "timeout",
            latency_ms=latency,
            handshake_ms=handshake_ms,
            speed_kbps=speed_kbps,
        )
    exit_ip = parse_exit_ip(exit_body)
    if not exit_ip or exit_leaks(exit_ip, runner_ip):
        return ProxyAssessment(
            False,
            "exit",
            "exit_ip_leak",
            latency_ms=latency,
            handshake_ms=handshake_ms,
            speed_kbps=speed_kbps,
            exit_ip=exit_ip,
        )
    return ProxyAssessment(
        True,
        "ok",
        "",
        latency_ms=latency,
        handshake_ms=handshake_ms,
        speed_kbps=speed_kbps,
        exit_ip=exit_ip,
        samples=hits,
    )
