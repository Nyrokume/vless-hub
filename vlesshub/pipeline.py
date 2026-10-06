from __future__ import annotations

import time
from pathlib import Path

from vlesshub.collect import collect_all, load_config
from vlesshub.consistency import check_publish
from vlesshub.export import publish
from vlesshub.geo import GeoCache, apply_exit_countries, enrich
from vlesshub.health import (
    apply_source_health,
    begin_run,
    deprioritized_names,
    load_health,
    note_fetch,
    save_health,
)
from vlesshub.history import History
from vlesshub.models import VlessConfig
from vlesshub.parser import exported_config
from vlesshub.probe import ProbeResult, _proxy_probe_singbox, failure_reason, proxy_probe, tcp_probe
from vlesshub.rank import mix_proxy_targets, rank_published, select_candidates
from vlesshub.stability import Stability
from vlesshub.stages import CLIENT_URL_TIMEOUT_MS, client_url_timeout, dropped_after, is_core, kept_after_handshake, status_of
from vlesshub.tgcollect import collect_proxies, select_proxies
from vlesshub.tgparse import TgProxy
from vlesshub.tgprobe import probe_many
from vlesshub.tools import ensure_geoip, ensure_singbox, ensure_xray
from vlesshub.util import env_flag, env_int, log, utcnow
from vlesshub.vantage import VantageScan, annotate_vantage


def run_pipeline(
    *,
    sources_path: Path,
    out_dir: Path,
    state_dir: Path,
    site_dir: Path,
    max_tcp: int | None = None,
    max_proxy: int | None = None,
    max_tg: int | None = None,
    skip_proxy: bool = False,
    skip_download: bool = False,
) -> int:
    if not sources_path.is_file():
        log(f"sources file not found: {sources_path}")
        return 1
    if not site_dir.is_dir():
        log(f"site directory not found: {site_dir}")
        return 1
    started = time.perf_counter()
    root = sources_path.resolve().parent
    out_resolved = out_dir.resolve()
    if out_resolved == root or out_resolved == Path(root.anchor):
        log("refusing to use the repository root as the output directory")
        return 1

    settings, sources = load_config(sources_path)
    if max_tcp is None:
        max_tcp = env_int("VLESSHUB_MAX_TCP")
    if max_proxy is None:
        max_proxy = env_int("VLESSHUB_MAX_PROXY")
    if max_tg is None:
        max_tg = env_int("VLESSHUB_MAX_TG")
    if max_tcp is not None:
        settings.max_tcp_tests = max_tcp
    if max_proxy is not None:
        settings.max_proxy_tests = max_proxy
    if max_tg is not None:
        settings.max_tg_tests = max_tg
    if skip_proxy or env_flag("VLESSHUB_SKIP_PROXY"):
        settings.max_proxy_tests = 0

    log(
        f"vless-hub: tcp<={settings.max_tcp_tests} proxy<={settings.max_proxy_tests} "
        f"tg<={settings.max_tg_tests} batch={settings.proxy_batch_size} "
        f"xray={settings.proxy_concurrency} drop_after={settings.drop_after_failures}"
    )
    state_dir.mkdir(parents=True, exist_ok=True)
    health = load_health(state_dir / "source_health.json")
    paused = begin_run(health)
    if paused:
        log(f"paused sources: {', '.join(sorted(paused))}")
    vless_sources = [source for source in sources if source.kind != "telegram-proxy"]
    tg_sources = [source for source in sources if source.kind == "telegram-proxy"]
    reports, configs, rejections = collect_all(settings, vless_sources, paused)
    rejections.setdefault("dead", 0)
    rejections.setdefault("timeout", 0)
    tg_reports, tg_found = collect_proxies(settings, tg_sources, paused)
    for report in reports + tg_reports:
        note_fetch(health, report)
    if not any(report.ok for report in reports) and not any(report.ok for report in tg_reports):
        log("every source failed; nothing to publish")
        save_health(state_dir / "source_health.json", health)
        return 1

    stability = Stability.load(out_dir / "data" / "stability.json")
    history = History.load(state_dir / "history.json")
    blocked = deprioritized_names(health)
    if blocked:
        log(f"deprioritized sources: {', '.join(sorted(blocked))}")
    had_success = history.has_success()
    proven_before = {
        fingerprint
        for fingerprint, entry in history.entries.items()
        if isinstance(entry, dict) and int(entry.get("ok", 0)) > 0 and int(entry.get("streak_fail", 0)) == 0
    }
    history.mark_misses({cfg.fingerprint for cfg in configs})

    alive = [
        cfg
        for cfg in configs
        if not dropped_after(stability.bits(cfg.fingerprint), settings.drop_after_failures)
        and not history.excluded(cfg.fingerprint, settings.drop_after_failures)
    ]
    dropped = len(configs) - len(alive)
    if dropped:
        log(f"dropped {dropped} configs after {settings.drop_after_failures} failed runs")
    tcp_pool = [cfg for cfg in alive if cfg.protocol not in {"hysteria2", "tuic"}]
    hy2_pool = [cfg for cfg in alive if cfg.protocol in {"hysteria2", "tuic"}]
    candidates = select_candidates(
        tcp_pool,
        history,
        settings.max_tcp_tests,
        settings.drop_after_failures,
        blocked,
    )
    log(f"tcp candidates {len(candidates)} (hysteria2 skips tcp: {len(hy2_pool)})")
    tcp = tcp_probe(candidates, settings.tcp_timeout_sec, settings.tcp_concurrency)
    tcp_ok = [cfg for cfg in candidates if tcp.get(cfg.fingerprint) and tcp[cfg.fingerprint].ok]

    proxy_results: dict[str, ProbeResult] = {}
    proxy_targets: list[VlessConfig] = []
    if settings.max_proxy_tests > 0 and (tcp_ok or hy2_pool) and not skip_download:
        proxy_targets = mix_proxy_targets(
            tcp_ok,
            hy2_pool,
            history,
            settings.max_proxy_tests,
            settings.drop_after_failures,
            blocked,
        )
        ready, mismatched = _lock_exports(proxy_targets)
        for cfg in mismatched:
            proxy_results[cfg.fingerprint] = ProbeResult(
                False, error="export mismatch", stage="parse", reason="export_mismatch"
            )
        proxy_targets = ready + mismatched
        needs_xray = any(cfg.protocol not in {"hysteria2", "tuic"} for cfg in ready)
        needs_singbox = any(cfg.protocol in {"hysteria2", "tuic"} for cfg in ready) or any(
            cfg.protocol in {"vless", "trojan", "shadowsocks"} and cfg.network in _SINGBOX_NETS for cfg in ready
        )
        xray = ensure_xray(root / "bin") if needs_xray else None
        singbox = ensure_singbox(root / "bin") if needs_singbox else None
        if needs_xray and xray is None and not any(cfg.protocol in {"hysteria2", "tuic"} for cfg in ready):
            log("proxy tests skipped because Xray is unavailable")
            proxy_targets = mismatched
        else:
            hy2_n = sum(1 for cfg in ready if cfg.protocol in {"hysteria2", "tuic"})
            log(f"proxy candidates {len(ready)} udp={hy2_n} export_mismatch={len(mismatched)}")
            if ready:
                proxy_results.update(
                    proxy_probe(
                        ready,
                        xray,
                        settings.proxy_timeout_sec,
                        settings.speed_timeout_sec,
                        settings.proxy_concurrency,
                        settings.proxy_batch_size,
                        singbox_bin=singbox,
                    )
                )
                _confirm(ready, proxy_results, settings, xray, singbox)
                _rescue_previous(
                    alive,
                    proven_before,
                    proxy_targets,
                    proxy_results,
                    settings,
                    xray,
                    singbox,
                    history,
                    blocked,
                )
                _note_cores(proxy_targets, proxy_results, settings, singbox)
    elif settings.max_proxy_tests > 0 and skip_download:
        log("proxy tests skipped (--skip-download)")

    tested_proxy = {cfg.fingerprint for cfg in proxy_targets}
    probed = {cfg.fingerprint: cfg for cfg in proxy_targets}
    working: list[VlessConfig] = []
    evaluated: list[tuple[VlessConfig, bool]] = []

    def _reject(result: ProbeResult | None) -> None:
        reason = failure_reason(result)
        if not reason:
            return
        rejections[reason] = rejections.get(reason, 0) + 1

    def _seed(cfg: VlessConfig) -> None:
        entry = history.get(cfg.fingerprint)
        stability.seed(cfg.fingerprint, str((entry or {}).get("bits") or ""))

    def _mark(cfg: VlessConfig, ok: bool) -> None:
        bits = stability.note(cfg.fingerprint, ok)
        cfg.bits = bits
        cfg.stability = stability.rate(cfg.fingerprint)
        cfg.status = status_of(ok, bits)
        if cfg.stability is not None:
            cfg.uptime = cfg.stability

    def _accept(cfg: VlessConfig, result: ProbeResult) -> None:
        cfg.latency_ms = result.latency_ms
        cfg.handshake_ms = result.handshake_ms
        cfg.speed_kbps = result.speed_kbps
        cfg.exit_ip = result.exit_ip
        cfg.verified = "proxy"
        _seed(cfg)
        recorded = history.record(cfg.fingerprint, ok=True, latency_ms=result.latency_ms)
        cfg.tested_at = str(recorded.get("last_ok") or "")
        _mark(cfg, True)
        working.append(cfg)
        evaluated.append((cfg, True))

    def _fail_proxy(cfg: VlessConfig, result: ProbeResult | None) -> None:
        if result is not None and not result.evaluated:
            history.seen(cfg.fingerprint)
            return
        cfg.latency_ms = None
        cfg.verified = ""
        cfg.status = "dead"
        _seed(cfg)
        history.record(cfg.fingerprint, ok=False, latency_ms=None)
        _mark(cfg, False)
        _reject(result)
        evaluated.append((cfg, False))

    for cfg in candidates:
        tcp_result = tcp.get(cfg.fingerprint)
        proxy_result = proxy_results.get(cfg.fingerprint)
        if cfg.fingerprint in tested_proxy:
            chosen = probed.get(cfg.fingerprint, cfg)
            if proxy_result and proxy_result.ok:
                _accept(chosen, proxy_result)
            else:
                _fail_proxy(chosen, proxy_result)
        elif tcp_result and tcp_result.ok:
            # Open port only. Not a success and not a displayed latency.
            cfg.latency_ms = None
            cfg.speed_kbps = None
            cfg.verified = "tcp"
            history.seen(cfg.fingerprint)
        elif tcp_result is not None and not tcp_result.evaluated:
            history.seen(cfg.fingerprint)
        else:
            cfg.status = "dead"
            _seed(cfg)
            history.record(cfg.fingerprint, ok=False, latency_ms=None)
            _mark(cfg, False)
            _reject(tcp_result)
            evaluated.append((cfg, False))

    for cfg in proxy_targets:
        if cfg.protocol not in {"hysteria2", "tuic"}:
            continue
        proxy_result = proxy_results.get(cfg.fingerprint)
        if proxy_result and proxy_result.ok:
            _accept(cfg, proxy_result)
        else:
            _fail_proxy(cfg, proxy_result)

    apply_source_health(reports, evaluated, health)
    save_health(state_dir / "source_health.json", health)

    cache = GeoCache.load(state_dir / "geo_cache.json")
    mmdb = None if skip_download else ensure_geoip(root / "data" / "Country.mmdb")
    passed = list(working)
    passed_ids = {cfg.fingerprint for cfg in passed}
    enrich(passed, cache, mmdb, settings.user_agent)
    apply_exit_countries(passed, mmdb)
    for cfg in passed:
        entry = history.get(cfg.fingerprint)
        if entry is not None and cfg.country:
            entry["country"] = cfg.country
        history.apply_to(cfg.fingerprint, cfg)
        if cfg.fingerprint in passed_ids:
            cfg.bits = stability.bits(cfg.fingerprint)
            cfg.stability = stability.rate(cfg.fingerprint)
            if cfg.stability is not None:
                cfg.uptime = cfg.stability
            cfg.status = status_of(True, cfg.bits)

    history.prune(settings.drop_after_failures)
    history.save(state_dir / "history.json")

    tg_history = History.load(state_dir / "tg_history.json")
    tg_published, tg_unstable, tg_tested = _probe_telegram(
        settings, tg_found, tg_history, cache, mmdb, stability, rejections, tg_reports, health
    )
    save_health(state_dir / "source_health.json", health)
    tg_history.prune(settings.drop_after_failures)
    tg_history.save(state_dir / "tg_history.json")
    cache.save(state_dir / "geo_cache.json")

    kept: list[VlessConfig] = []
    slow = 0
    for cfg in working:
        if client_url_timeout(cfg.latency_ms):
            slow += 1
            continue
        kept.append(cfg)
    if slow:
        log(f"dropped {slow} slower than {CLIENT_URL_TIMEOUT_MS:.0f} ms")
    working = kept
    scan = VantageScan()
    if working and settings.vantage_checks > 0 and not skip_download:
        scan = annotate_vantage(
            working,
            settings.vantage_checks,
            settings.user_agent,
            budget_sec=settings.vantage_budget_sec,
        )
        if scan.closed_endpoints:
            before = len(working)
            working = [cfg for cfg in working if (cfg.host, cfg.port) not in scan.closed_endpoints]
            log(f"dropped {before - len(working)} closed from Russia")
    published = rank_published(working)
    proxy_ok = len(published)
    log(
        f"publish {len(published)} working from {len(configs)} unique; "
        f"proxy tested {len(proxy_targets)}; rejected {rejections}"
    )
    if not published and had_success:
        log("no proxy-verified configs left for this run; history was saved, site was left unchanged")
        return 2

    publish(
        out_dir=out_dir,
        site_dir=site_dir,
        configs=published,
        unstable=[],
        unverified=[],
        reports=reports,
        collected=sum(report.links for report in reports),
        unique=len(configs),
        rejections=rejections,
        tcp_tested=len(candidates),
        tcp_ok=len(tcp_ok),
        proxy_tested=len(proxy_targets),
        proxy_ok=proxy_ok,
        generated_at=utcnow(),
        duration_sec=round(time.perf_counter() - started, 1),
        settings=settings,
        proxies=tg_published,
        tg_unstable=tg_unstable,
        tg_reports=tg_reports,
        tg_collected=len(tg_found),
        tg_tested=tg_tested,
        vantage={
            "checked": scan.checked,
            "open_from_russia": scan.open,
            "closed_from_russia": scan.closed,
            "unknown": scan.unknown,
        },
    )
    stability.save(out_dir / "data" / "stability.json")
    mismatches = check_publish(out_dir)
    if mismatches:
        for item in mismatches:
            log(f"export check: {item}")
        return 1
    log(f"site written to {out_dir}")
    return 0


_SINGBOX_NETS = {"tcp", "ws", "grpc", "h2", "xhttp", "httpupgrade"}
_UDP = {"hysteria2", "tuic"}


def _lock_exports(configs: list[VlessConfig]) -> tuple[list[VlessConfig], list[VlessConfig]]:
    ready: list[VlessConfig] = []
    broken: list[VlessConfig] = []
    for cfg in configs:
        exported = exported_config(cfg)
        if exported is None:
            broken.append(cfg)
            continue
        ready.append(exported)
    return ready, broken


def _probe_call(configs, settings, xray, singbox):
    return proxy_probe(
        configs,
        xray,
        settings.proxy_timeout_sec,
        settings.speed_timeout_sec,
        settings.proxy_concurrency,
        settings.proxy_batch_size,
        singbox_bin=singbox,
    )


def _confirm(configs, results: dict[str, ProbeResult], settings, xray, singbox) -> None:
    passed = [cfg for cfg in configs if (hit := results.get(cfg.fingerprint)) and hit.ok and hit.evaluated]
    rounds = max(0, settings.confirm_rounds)
    for index in range(rounds):
        if not passed:
            break
        time.sleep(1.0)
        log(f"confirm {index + 1}/{rounds} on {len(passed)}")
        again = _probe_call(passed, settings, xray, singbox)
        still: list[VlessConfig] = []
        for cfg in passed:
            hit = again.get(cfg.fingerprint)
            if hit is None or not hit.evaluated:
                still.append(cfg)
                continue
            if hit.ok:
                results[cfg.fingerprint] = hit
                still.append(cfg)
                continue
            hit.reason = "flaky"
            hit.ok = False
            results[cfg.fingerprint] = hit
        passed = still


def _rescue_previous(alive, proven_before, proxy_targets, results, settings, xray, singbox, history, blocked) -> None:
    passed = [cfg for cfg in proxy_targets if (hit := results.get(cfg.fingerprint)) and hit.ok]
    if len(passed) >= settings.min_working or not proven_before:
        if len(passed) < settings.min_working:
            log(
                f"warning: only {len(passed)} working configs; publishing the verified ones"
            )
        return
    tested = {cfg.fingerprint for cfg in proxy_targets}
    missing = [cfg for cfg in alive if cfg.fingerprint in proven_before and cfg.fingerprint not in tested]
    log(f"warning: only {len(passed)} working; retesting {len(missing)} previously working")
    if not missing or xray is None and singbox is None:
        log("warning: few working configs after retest; publishing only verified ones")
        return
    from vlesshub.rank import select_candidates

    extra = select_candidates(missing, history, min(400, settings.max_proxy_tests), settings.drop_after_failures, blocked)
    ready, mismatched = _lock_exports(extra)
    for cfg in mismatched:
        results[cfg.fingerprint] = ProbeResult(False, error="export mismatch", stage="parse", reason="export_mismatch")
        proxy_targets.append(cfg)
    if ready:
        results.update(_probe_call(ready, settings, xray, singbox))
        _confirm(ready, results, settings, xray, singbox)
        proxy_targets.extend(ready)
    still = [cfg for cfg in proxy_targets if (hit := results.get(cfg.fingerprint)) and hit.ok]
    if len(still) < settings.min_working:
        log(f"warning: {len(still)} working after retest; publishing only verified ones")


def _note_cores(configs, results: dict[str, ProbeResult], settings, singbox) -> None:
    passed = [
        cfg
        for cfg in configs
        if cfg.protocol not in _UDP
        and cfg.network in _SINGBOX_NETS
        and (hit := results.get(cfg.fingerprint))
        and hit.ok
    ]
    second: dict[str, ProbeResult] = {}
    if passed and singbox is not None:
        log(f"sing-box check on {len(passed)}")
        second = _proxy_probe_singbox(
            passed,
            singbox,
            settings.proxy_timeout_sec,
            0.0,
            settings.proxy_concurrency,
            min(8, settings.proxy_batch_size),
        )
    for cfg in configs:
        hit = results.get(cfg.fingerprint)
        if not hit or not hit.ok:
            continue
        if cfg.protocol in _UDP:
            cfg.core = "sing-box"
            continue
        other = second.get(cfg.fingerprint)
        cfg.core = "xray+sing-box" if other and other.ok else "xray"


def _probe_telegram(
    settings,
    found: list[TgProxy],
    history: History,
    cache: GeoCache,
    mmdb,
    stability: Stability,
    rejections: dict[str, int],
    reports,
    health: dict,
) -> tuple[list[TgProxy], list[TgProxy], int]:
    if not found:
        return [], [], 0
    history.mark_misses({proxy.fingerprint for proxy in found})
    pool = [
        proxy
        for proxy in found
        if not dropped_after(stability.bits(proxy.fingerprint, telegram=True), settings.drop_after_failures)
        and not history.excluded(proxy.fingerprint, settings.drop_after_failures)
    ]
    targets = select_proxies(pool, history, settings.max_tg_tests, settings.drop_after_failures)
    log(f"tg candidates {len(targets)} of {len(found)}")
    results = probe_many(targets, settings.tg_timeout_sec, settings.tg_concurrency) if targets else {}
    tested = {proxy.fingerprint for proxy in targets}
    working: list[TgProxy] = []
    evaluated: list[tuple[TgProxy, bool]] = []

    def _remember(proxy: TgProxy, ok: bool) -> None:
        bits = stability.note(proxy.fingerprint, ok, telegram=True)
        proxy.bits = bits
        proxy.stability = stability.rate(proxy.fingerprint, telegram=True)
        proxy.status = status_of(ok, bits)
        if proxy.stability is not None:
            proxy.uptime = proxy.stability

    for proxy in targets:
        result = results.get(proxy.fingerprint)
        if result and kept_after_handshake(result.ok, result.latency_ms):
            proxy.latency_ms = result.latency_ms
            proxy.verified = proxy.kind
            stability.seed(proxy.fingerprint, str((history.get(proxy.fingerprint) or {}).get("bits") or ""), telegram=True)
            history.record(proxy.fingerprint, ok=True, latency_ms=result.latency_ms)
            _remember(proxy, True)
            working.append(proxy)
            evaluated.append((proxy, True))
        else:
            proxy.latency_ms = None
            proxy.status = "dead"
            stability.seed(proxy.fingerprint, str((history.get(proxy.fingerprint) or {}).get("bits") or ""), telegram=True)
            history.record(proxy.fingerprint, ok=False, latency_ms=None)
            _remember(proxy, False)
            reason = "timeout" if result and result.ok else ((result.reason if result else "") or "handshake_fail")
            rejections[reason] = rejections.get(reason, 0) + 1
            evaluated.append((proxy, False))
    apply_source_health(reports, evaluated, health)
    passed = list(working)
    enrich(passed, cache, mmdb, settings.user_agent)
    passed_ids = {proxy.fingerprint for proxy in passed}
    for proxy in passed:
        entry = history.get(proxy.fingerprint)
        if entry is not None and proxy.country:
            entry["country"] = proxy.country
        history.apply_to(proxy.fingerprint, proxy)
        if proxy.fingerprint in passed_ids:
            proxy.bits = stability.bits(proxy.fingerprint, telegram=True)
            proxy.stability = stability.rate(proxy.fingerprint, telegram=True)
            if proxy.stability is not None:
                proxy.uptime = proxy.stability
            proxy.status = status_of(True, proxy.bits)
    for proxy in found:
        if proxy.fingerprint not in tested:
            history.seen(proxy.fingerprint)

    def _rank(items: list[TgProxy]) -> list[TgProxy]:
        return sorted(
            items,
            key=lambda proxy: (
                0 if is_core(proxy.bits) else 1,
                proxy.latency_ms if proxy.latency_ms is not None else 9_999_999,
                -(proxy.stability or 0),
                proxy.fingerprint,
            ),
        )

    ranked = _rank(working)
    log(f"tg working {len(ranked)} of {len(targets)} tested")
    return ranked, [], len(targets)
