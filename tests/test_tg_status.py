from vlesshub.stages import status_of
from vlesshub.tgprobe import classify_tg_error


def test_telegram_errors_use_plain_reason_codes():
    assert classify_tg_error("TimeoutError: timed out") == "timeout"
    assert classify_tg_error("ConnectionRefusedError: [Errno 111] Connection refused") == "tcp_refused"
    assert classify_tg_error("MtprotoError: fake-tls server hello rejected") == "mtproto_fail"
    assert classify_tg_error("SocksError: socks connect 5") == "socks_fail"
    assert classify_tg_error("ConnectionError: closed") == "handshake_fail"


def test_telegram_status_is_this_run_only():
    assert status_of(True, "1111111") == "working"
    assert status_of(True, "0000001") == "working"
    assert status_of(False, "1111111") == "dead"
