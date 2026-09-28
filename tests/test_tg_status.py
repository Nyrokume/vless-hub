from vlesshub.stages import status_of
from vlesshub.tgprobe import classify_tg_error


def test_telegram_errors_use_the_same_reason_codes():
    assert classify_tg_error("TimeoutError: timed out") == "timeout"
    assert classify_tg_error("ConnectionRefusedError: [Errno 111] Connection refused") == "tcp_refused"
    assert classify_tg_error("ConnectionError: fake-tls server hello rejected") == "handshake_fail"


def test_telegram_status_follows_the_recent_window():
    assert status_of(True, "1111111") == "working"
    assert status_of(True, "0000001") == "unstable"
    assert status_of(False, "1111111") == "dead"
