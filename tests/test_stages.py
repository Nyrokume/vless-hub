from vlesshub.parser import fingerprint, parse_vless
from vlesshub.stages import (
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
