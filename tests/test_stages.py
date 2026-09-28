from vlesshub.parser import fingerprint, parse_vless
from vlesshub.probe import ProbeResult, failure_reason
from vlesshub.stages import (
    HTTP_TARGETS,
    HttpSample,
    assess_proxy,
    classify_failure,
    dropped_after,
    exit_leaks,
    majority,
    median_ms,
    note_bits,
    status_of,
)


def test_stage_reasons_cover_tcp_handshake_http_and_exit():
    assert classify_failure("tcp", "timeout") == "timeout"
    assert classify_failure("tcp", "connection refused") == "tcp_refused"
    assert classify_failure("handshake", "timeout", "reality") == "timeout"
    assert classify_failure("handshake", "handshake failure", "reality") == "reality_fail"
    assert classify_failure("handshake", "tls alert", "tls") == "tls_fail"
    assert classify_failure("handshake", "reset", "none") == "handshake_fail"
    assert classify_failure("http", "http 403") == "http_fail"
    assert classify_failure("throughput", "short body") == "no_data"
    assert classify_failure("exit", "same ip") == "exit_ip_leak"
    assert classify_failure("parse", "truncated") == "parse_error"
    assert classify_failure("parse", "invalid uuid") == "invalid_field"


def test_http_majority_needs_more_than_half():
    assert majority(2, 3)
    assert not majority(1, 3)
    assert majority(1, 1)
    assert not majority(0, 3)


def test_ping_is_the_median_of_successful_round_trips():
    assert median_ms([80, 200, 120]) == 120
    assert median_ms([50, 0, 70]) == 60
    assert median_ms([]) is None


def test_status_uses_this_run_and_recent_history():
    assert status_of(True, "1111111") == "working"
    assert status_of(True, "0000001") == "unstable"
    assert status_of(True, "1111110" + "1") == "working"
    assert status_of(False, "1111111") == "dead"
    assert status_of(True, "") == "working"


def test_bits_keep_a_window_and_drop_a_long_dead_streak():
    assert note_bits("111", False, window=4) == "1110"
    assert note_bits("11110", True, window=4) == "1101"
    assert dropped_after("1110000", 4)
    assert not dropped_after("111000", 4)
    assert not dropped_after("0001111", 4)


def test_exit_leak_requires_both_addresses():
    assert exit_leaks("203.0.113.8", "203.0.113.8")
    assert not exit_leaks("198.51.100.4", "203.0.113.8")
    assert not exit_leaks("", "203.0.113.8")


def _ok(start_ms: float, code: int = 204) -> HttpSample:
    return HttpSample(code=code, start_ms=start_ms, total_ms=start_ms + 20, size=0)


def test_assess_splits_handshake_from_median_ping():
    targets = [(expected, [_ok(100), _ok(140), _ok(120)][index : index + 1]) for index, (_, expected) in enumerate(HTTP_TARGETS)]
    speed = HttpSample(code=200, start_ms=80, total_ms=2000, size=250_000)
    result = assess_proxy(
        security="reality",
        warmup=_ok(900),
        targets=targets,
        speed=speed,
        exit_body="198.51.100.9\n",
        exit_timed_out=False,
        runner_ip="203.0.113.4",
    )
    assert result.ok
    assert result.stage == "ok"
    assert result.handshake_ms == 900
    assert result.latency_ms == 120
    assert result.speed_kbps == round((250_000 / 1024) / 2, 1)
    assert result.exit_ip == "198.51.100.9"


def test_assess_retries_count_toward_majority_and_http_fail_does_not():
    expected = HTTP_TARGETS[0][1]
    targets = [
        (expected, [HttpSample(timed_out=True), _ok(80)]),
        (expected, [HttpSample(code=403, start_ms=30, total_ms=40)]),
        (expected, [HttpSample(timed_out=True), HttpSample(timed_out=True)]),
    ]
    failed = assess_proxy(
        security="tls",
        warmup=_ok(50),
        targets=targets,
        speed=None,
        exit_body="",
        exit_timed_out=False,
        runner_ip="203.0.113.4",
    )
    assert not failed.ok
    assert failed.stage == "http"
    assert failed.reason == "http_fail"
    assert failed.handshake_ms == 50
    assert failed.latency_ms is None

    passed = assess_proxy(
        security="tls",
        warmup=_ok(50),
        targets=[
            (expected, [HttpSample(code=0), _ok(110)]),
            (expected, [_ok(90)]),
            (expected, [HttpSample(timed_out=True)]),
        ],
        speed=HttpSample(code=200, start_ms=40, total_ms=1000, size=200_000),
        exit_body="2001:db8::1",
        exit_timed_out=False,
        runner_ip="203.0.113.4",
    )
    assert passed.ok
    assert passed.latency_ms == 100
    assert passed.exit_ip == "2001:db8::1"


def test_assess_rejects_zombies_and_exit_leaks():
    expected = HTTP_TARGETS[0][1]
    targets = [(expected, [_ok(70)]) for _ in HTTP_TARGETS]
    zombie = assess_proxy(
        security="none",
        warmup=_ok(40),
        targets=targets,
        speed=HttpSample(code=200, start_ms=10, total_ms=500, size=100),
        exit_body="",
        exit_timed_out=False,
        runner_ip="203.0.113.4",
    )
    assert zombie.reason == "no_data"
    assert zombie.stage == "throughput"

    leak = assess_proxy(
        security="reality",
        warmup=_ok(40),
        targets=targets,
        speed=HttpSample(code=200, start_ms=10, total_ms=1000, size=200_000),
        exit_body="203.0.113.4",
        exit_timed_out=False,
        runner_ip="203.0.113.4",
    )
    assert leak.reason == "exit_ip_leak"
    assert leak.stage == "exit"


def test_assess_handshake_uses_security_and_timeout():
    reality = assess_proxy(
        security="reality",
        warmup=HttpSample(code=0),
        targets=[],
        speed=None,
        exit_body="",
        exit_timed_out=False,
        runner_ip="",
    )
    assert reality.stage == "handshake"
    assert reality.reason == "reality_fail"
    timed = assess_proxy(
        security="tls",
        warmup=HttpSample(timed_out=True),
        targets=[],
        speed=None,
        exit_body="",
        exit_timed_out=False,
        runner_ip="",
    )
    assert timed.reason == "timeout"


def test_failure_reason_keeps_the_stage_and_skips_untested():
    assert failure_reason(ProbeResult(False, reason="tcp_refused", stage="tcp")) == "tcp_refused"
    assert failure_reason(ProbeResult(False, error="budget", evaluated=False)) == ""
    assert failure_reason(ProbeResult(True, latency_ms=80)) == ""
    assert failure_reason(None) == ""


def test_dedup_key_ignores_remark_and_parameter_order():
    left = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@de.example:443"
        "?type=tcp&security=tls&sni=de.example#fast-de"
    )
    right = parse_vless(
        "vless://11111111-1111-4111-8111-111111111111@de.example:443"
        "?security=tls&sni=de.example&type=tcp#slow-nl"
    )
    assert left is not None and right is not None
    assert fingerprint(left) == fingerprint(right)
    assert left.fingerprint == right.fingerprint
