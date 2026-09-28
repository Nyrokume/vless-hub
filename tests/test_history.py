from vlesshub.history import History


def test_failures_drop_and_success_clears_streak(tmp_path):
    history = History()
    fingerprint = "abc123"
    for _ in range(4):
        history.record(fingerprint, ok=False, latency_ms=None)
    assert history.excluded(fingerprint, drop_after=4)
    assert history.get(fingerprint)["bits"] == "0000"
    history.record(fingerprint, ok=True, latency_ms=180)
    assert not history.excluded(fingerprint, drop_after=4)
    entry = history.get(fingerprint)
    assert entry["streak_fail"] == 0
    assert entry["streak_ok"] == 1
    assert entry["ema_ms"] == 180
    assert entry["bits"].endswith("1")
    history.record(fingerprint, ok=True, latency_ms=100)
    assert history.get(fingerprint)["ema_ms"] == round(180 * 0.7 + 100 * 0.3, 1)
    poisoned = History()
    poisoned.record("edge", ok=True, latency_ms=0.3)
    poisoned.record("edge", ok=True, latency_ms=180)
    assert poisoned.get("edge")["ema_ms"] == 180
    assert history.uptime(fingerprint) == 2 / 6

    path = tmp_path / "history.json"
    history.save(path)
    loaded = History.load(path)
    assert loaded.get(fingerprint)["ok"] == 2
    assert loaded.has_success()


def test_misses_and_prune():
    history = History()
    history.record("keep", ok=True, latency_ms=50)
    history.record("gone", ok=True, latency_ms=50)
    history.mark_misses({"keep"})
    assert history.get("keep")["miss"] == 0
    assert history.get("gone")["miss"] == 1
    for _ in range(9):
        history.mark_misses({"keep"})
    history.prune(drop_after=4)
    assert history.get("keep") is not None
    assert history.get("gone") is None

    fresh = History()
    for _ in range(8):
        fresh.record("dead", ok=False, latency_ms=None)
    fresh.prune(drop_after=4)
    assert fresh.get("dead") is None


def test_seen_resets_miss_without_counting_success():
    history = History()
    history.record("known", ok=True, latency_ms=80)
    history.mark_misses(set())
    assert history.get("known")["miss"] == 1
    history.seen("known")
    assert history.get("known")["miss"] == 0
    assert history.get("known")["ok"] == 1
    history.seen("open-port")
    entry = history.get("open-port")
    assert entry is not None
    assert entry["ok"] == 0
    assert entry["fail"] == 0
    assert entry["miss"] == 0
