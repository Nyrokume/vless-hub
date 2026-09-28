"""Pure rules for the multi-stage probe: reasons, majority, ping, and status."""

from __future__ import annotations

import statistics

HTTP_TARGETS: tuple[tuple[str, frozenset[int]], ...] = (
    ("https://www.gstatic.com/generate_204", frozenset({204, 200})),
    ("https://cp.cloudflare.com/generate_204", frozenset({204, 200})),
    ("https://www.google.com/generate_204", frozenset({204, 200})),
)
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
    "tcp_refused",
    "timeout",
    "tls_fail",
    "reality_fail",
    "handshake_fail",
    "http_fail",
    "no_data",
    "exit_ip_leak",
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
        return "timeout" if timed_out else "http_fail"
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
    """working passed now with a solid history, unstable passed now but rarely, dead failed now."""
    if not passed_now:
        return "dead"
    window = [char == "1" for char in bits if char in {"0", "1"}]
    if not window:
        return "working"
    rate = sum(1 for item in window if item) / len(window)
    if rate < min_rate:
        return "unstable"
    return "working"


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
