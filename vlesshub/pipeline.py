from __future__ import annotations

import time
from pathlib import Path

from vlesshub.collect import collect_all, load_config
from vlesshub.export import publish
from vlesshub.geo import GeoCache, apply_exit_countries, enrich
from vlesshub.health import apply_source_health, deprioritized_names, load_health, save_health
from vlesshub.history import History
from vlesshub.models import VlessConfig
from vlesshub.probe import ProbeResult, failure_reason, proxy_probe, tcp_probe
from vlesshub.rank import mix_proxy_targets, rank_published, select_candidates
from vlesshub.stability import Stability
from vlesshub.stages import dropped_after, status_of
from vlesshub.tgcollect import collect_proxies, select_proxies
from vlesshub.tgparse import TgProxy
from vlesshub.tgprobe import probe_many
from vlesshub.tools import ensure_geoip, ensure_singbox, ensure_xray
from vlesshub.util import env_flag, env_int, log, utcnow


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
    vless_sources = [source for source in sources if source.kind != "telegram-proxy"]
    tg_sources = [source for source in sources if source.kind == "telegram-proxy"]
    reports, configs, rejections = collect_all(settings, vless_sources)
    rejections.setdefault("dead", 0)
    rejections.setdefault("timeout", 0)
    tg_reports, tg_found = collect_proxies(settings, tg_sources)
    if not any(report.ok for report in reports) and not any(report.ok for report in tg_reports):
        log("every source failed; nothing to publish")
        return 1

    state_dir.mkdir(parents=True, exist_ok=True)
    stability = Stability.load(out_dir / "data" / "stability.json")
    history = History.load(state_dir / "history.json")
    health = load_health(state_dir / "source_health.json")
    blocked = deprioritized_names(health)
    if blocked:
        log(f"deprioritized sources: {', '.join(sorted(blocked))}")
    had_success = history.has_success()
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
    tcp_pool = [cfg for cfg in alive if cfg.protocol != "hysteria2"]
    hy2_pool = [cfg for cfg in alive if cfg.protocol == "hysteria2"]
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
        needs_xray = any(cfg.protocol != "hysteria2" for cfg in proxy_targets)
        needs_singbox = any(cfg.protocol == "hysteria2" for cfg in proxy_targets)
        xray = ensure_xray(root / "bin") if needs_xray else None
        singbox = ensure_singbox(root / "bin") if needs_singbox else None
        if needs_xray and xray is None and not needs_singbox:
            log("proxy tests skipped because Xray is unavailable")
            proxy_targets = []
        else:
            hy2_n = sum(1 for cfg in proxy_targets if cfg.protocol == "hysteria2")
            log(f"proxy candidates {len(proxy_targets)} hysteria2={hy2_n}")
            proxy_results = proxy_probe(
                proxy_targets,
                xray,
                settings.proxy_timeout_sec,
                settings.speed_timeout_sec,
                settings.proxy_concurrency,
                settings.proxy_batch_size,
                singbox_bin=singbox,
            )
    elif settings.max_proxy_tests > 0 and skip_download:
        log("proxy tests skipped (--skip-download)")

    tested_proxy = {cfg.fingerprint for cfg in proxy_targets}
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
            if proxy_result and proxy_result.ok:
                _accept(cfg, proxy_result)
            else:
                _fail_proxy(cfg, proxy_result)
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
        if cfg.protocol != "hysteria2":
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
        settings, tg_found, tg_history, cache, mmdb, stability, rejections
    )
    tg_history.prune(settings.drop_after_failures)
    tg_history.save(state_dir / "tg_history.json")
    cache.save(state_dir / "geo_cache.json")

    published = rank_published(working)
    proxy_ok = len(published)
    log(
        f"publish {len(published)} working from {len(configs)} unique; "
        f"proxy tested {len(proxy_targets)}; rejected {rejections}"
    )
    if not passed and had_success:
        log("no proxy-verified configs in this run; history was saved, site was left unchanged")
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
    )
    stability.save(out_dir / "data" / "stability.json")
    log(f"site written to {out_dir}")
    return 0


def _probe_telegram(
    settings,
    found: list[TgProxy],
    history: History,
    cache: GeoCache,
    mmdb,
    stability: Stability,
    rejections: dict[str, int],
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

    def _remember(proxy: TgProxy, ok: bool) -> None:
        bits = stability.note(proxy.fingerprint, ok, telegram=True)
        proxy.bits = bits
        proxy.stability = stability.rate(proxy.fingerprint, telegram=True)
        proxy.status = status_of(ok, bits)
        if proxy.stability is not None:
            proxy.uptime = proxy.stability

    for proxy in targets:
        result = results.get(proxy.fingerprint)
        if result and result.ok:
            proxy.latency_ms = result.latency_ms
            proxy.verified = proxy.kind
            stability.seed(proxy.fingerprint, str((history.get(proxy.fingerprint) or {}).get("bits") or ""), telegram=True)
            history.record(proxy.fingerprint, ok=True, latency_ms=result.latency_ms)
            _remember(proxy, True)
            working.append(proxy)
        else:
            proxy.latency_ms = None
            proxy.status = "dead"
            stability.seed(proxy.fingerprint, str((history.get(proxy.fingerprint) or {}).get("bits") or ""), telegram=True)
            history.record(proxy.fingerprint, ok=False, latency_ms=None)
            _remember(proxy, False)
            reason = (result.reason if result else "") or "handshake_fail"
            rejections[reason] = rejections.get(reason, 0) + 1
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
                proxy.latency_ms if proxy.latency_ms is not None else 9_999_999,
                -(proxy.stability or 0),
                proxy.fingerprint,
            ),
        )

    ranked = _rank(working)
    log(f"tg working {len(ranked)} of {len(targets)} tested")
    return ranked, [], len(targets)
